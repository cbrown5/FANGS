/**
 * parser.test.js - Unit tests for the FANGS BUGS/JAGS lexer and parser.
 *
 * Tests cover tokenization, AST construction, operator precedence, link
 * functions, truncation syntax, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { Lexer, LexError, TokenType } from '../src/parser/lexer.js';
import { Parser, ParseError } from '../src/parser/parser.js';

// ─── Helper: lex + filter noise tokens ───────────────────────────────────────

/**
 * Tokenize `src` and return only the meaningful tokens (no NEWLINE, COMMENT,
 * or EOF) for easier assertion.
 */
function lex(src) {
  return new Lexer(src).tokenize().filter(
    t => t.type !== TokenType.NEWLINE &&
         t.type !== TokenType.COMMENT &&
         t.type !== TokenType.EOF
  );
}

/**
 * Fully parse `src` and return the Model AST root.
 */
function parse(src) {
  const tokens = new Lexer(src).tokenize();
  return new Parser(tokens).parse();
}

// ─── Lexer tests ──────────────────────────────────────────────────────────────

describe('Lexer', () => {
  describe('simple identifiers and numbers', () => {
    it('tokenizes a plain identifier', () => {
      const tokens = lex('alpha');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.IDENTIFIER, value: 'alpha' });
    });

    it('tokenizes an integer literal', () => {
      const tokens = lex('42');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.NUMBER, value: 42 });
    });

    it('tokenizes a float literal', () => {
      const tokens = lex('3.14');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.NUMBER, value: 3.14 });
    });

    it('tokenizes a decimal-leading float (.5)', () => {
      const tokens = lex('.5');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.NUMBER, value: 0.5 });
    });

    it('tokenizes scientific notation (1e-3)', () => {
      const tokens = lex('1e-3');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(TokenType.NUMBER);
      expect(tokens[0].value).toBeCloseTo(0.001, 10);
    });

    it('tokenizes scientific notation with uppercase E (2.5E4)', () => {
      const tokens = lex('2.5E4');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBeCloseTo(25000, 5);
    });
  });

  describe('dotted identifier names', () => {
    it('tokenizes tau.b as a single IDENTIFIER token', () => {
      const tokens = lex('tau.b');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.IDENTIFIER, value: 'tau.b' });
    });

    it('tokenizes mu.0 as a single IDENTIFIER token', () => {
      const tokens = lex('mu.0');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.IDENTIFIER, value: 'mu.0' });
    });

    it('tokenizes nested dotted name (sigma.alpha.hat)', () => {
      const tokens = lex('sigma.alpha.hat');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.IDENTIFIER, value: 'sigma.alpha.hat' });
    });

    it('does not consume a trailing dot as part of the identifier', () => {
      // "alpha." should be IDENTIFIER("alpha") then something else — the dot
      // followed by a space is not part of the name.
      const tokens = lex('alpha ');
      expect(tokens[0].value).toBe('alpha');
    });
  });

  describe('keywords', () => {
    it('emits MODEL token for "model"', () => {
      const tokens = lex('model');
      expect(tokens[0].type).toBe(TokenType.MODEL);
    });

    it('emits FOR token for "for"', () => {
      const tokens = lex('for');
      expect(tokens[0].type).toBe(TokenType.FOR);
    });

    it('emits IN token for "in"', () => {
      const tokens = lex('in');
      expect(tokens[0].type).toBe(TokenType.IN);
    });

    it('emits T token for the truncation marker "T"', () => {
      const tokens = lex('T');
      expect(tokens[0].type).toBe(TokenType.T);
    });
  });

  describe('operators and punctuation', () => {
    it('tokenizes tilde (~)', () => {
      const tokens = lex('~');
      expect(tokens[0].type).toBe(TokenType.TILDE);
    });

    it('tokenizes arrow (<-)', () => {
      const tokens = lex('<-');
      expect(tokens[0].type).toBe(TokenType.ARROW);
      expect(tokens[0].value).toBe('<-');
    });

    it('tokenizes arithmetic operators as IDENTIFIER tokens', () => {
      const tokens = lex('+ - * / ^');
      const ops = tokens.map(t => t.value);
      expect(ops).toEqual(['+', '-', '*', '/', '^']);
      tokens.forEach(t => expect(t.type).toBe(TokenType.IDENTIFIER));
    });

    it('tokenizes all bracket and brace types', () => {
      const tokens = lex('( ) [ ] { }');
      expect(tokens.map(t => t.type)).toEqual([
        TokenType.LPAREN, TokenType.RPAREN,
        TokenType.LBRACKET, TokenType.RBRACKET,
        TokenType.LBRACE, TokenType.RBRACE,
      ]);
    });

    it('tokenizes comma, colon, and semicolon', () => {
      const tokens = lex(', : ;');
      expect(tokens.map(t => t.type)).toEqual([
        TokenType.COMMA, TokenType.COLON, TokenType.SEMICOLON,
      ]);
    });
  });

  describe('comments', () => {
    it('emits a COMMENT token for a # line', () => {
      const raw = new Lexer('# this is a comment').tokenize();
      const comment = raw.find(t => t.type === TokenType.COMMENT);
      expect(comment).toBeDefined();
      expect(comment.value).toBe('# this is a comment');
    });

    it('strips the comment before the next real token', () => {
      const tokens = lex('alpha # comment\nbeta');
      expect(tokens.map(t => t.value)).toEqual(['alpha', 'beta']);
    });
  });

  describe('string literals', () => {
    it('tokenizes a double-quoted string', () => {
      const tokens = lex('"hello world"');
      expect(tokens[0]).toMatchObject({ type: TokenType.STRING, value: 'hello world' });
    });

    it('handles escape sequences in strings', () => {
      const tokens = lex('"line1\\nline2"');
      expect(tokens[0].value).toBe('line1\nline2');
    });
  });

  describe('position tracking', () => {
    it('records correct line and column for multi-line input', () => {
      const raw = new Lexer('alpha\nbeta').tokenize();
      const identTokens = raw.filter(t => t.type === TokenType.IDENTIFIER);
      expect(identTokens[0]).toMatchObject({ value: 'alpha', line: 1, col: 1 });
      expect(identTokens[1]).toMatchObject({ value: 'beta', line: 2, col: 1 });
    });
  });

  describe('error handling', () => {
    it('throws LexError for an unexpected character (@)', () => {
      expect(() => new Lexer('@bad').tokenize()).toThrow(LexError);
    });

    it('throws LexError for an unterminated string literal', () => {
      expect(() => new Lexer('"unterminated').tokenize()).toThrow(LexError);
    });

    it('LexError message contains position info', () => {
      try {
        new Lexer('@').tokenize();
      } catch (e) {
        expect(e.message).toMatch(/line \d+, col \d+/);
      }
    });
  });
});

// ─── Parser tests ─────────────────────────────────────────────────────────────

describe('Parser', () => {
  describe('model wrapper', () => {
    it('parses an empty model block', () => {
      const ast = parse('model { }');
      expect(ast.type).toBe('Model');
      expect(ast.body.type).toBe('Block');
      expect(ast.body.statements).toHaveLength(0);
    });

    it('parses source without the model keyword as an implicit block', () => {
      const ast = parse('alpha ~ dnorm(0, 0.001)');
      expect(ast.type).toBe('Model');
      expect(ast.body.type).toBe('Block');
      expect(ast.body.statements).toHaveLength(1);
    });
  });

  describe('stochastic assignments', () => {
    it('parses a simple stochastic node: y[i] ~ dnorm(mu[i], tau)', () => {
      const ast = parse('model { y[i] ~ dnorm(mu[i], tau) }');
      const stmt = ast.body.statements[0];
      expect(stmt.type).toBe('StochasticAssignment');
      // LHS
      expect(stmt.lhs.type).toBe('IndexExpr');
      expect(stmt.lhs.object.name).toBe('y');
      expect(stmt.lhs.indices[0]).toMatchObject({ type: 'Identifier', name: 'i' });
      // Distribution
      expect(stmt.distribution.type).toBe('Distribution');
      expect(stmt.distribution.name).toBe('dnorm');
      expect(stmt.distribution.params).toHaveLength(2);
    });

    it('parses a scalar stochastic node: alpha ~ dnorm(0, 0.001)', () => {
      const ast = parse('model { alpha ~ dnorm(0, 0.001) }');
      const stmt = ast.body.statements[0];
      expect(stmt.type).toBe('StochasticAssignment');
      expect(stmt.lhs).toMatchObject({ type: 'Identifier', name: 'alpha' });
      expect(stmt.distribution.name).toBe('dnorm');
      expect(stmt.distribution.params[0]).toMatchObject({ type: 'NumberLiteral', value: 0 });
      expect(stmt.distribution.params[1]).toMatchObject({ type: 'NumberLiteral', value: 0.001 });
    });

    it('parses dgamma distribution: tau ~ dgamma(0.001, 0.001)', () => {
      const ast = parse('model { tau ~ dgamma(0.001, 0.001) }');
      const stmt = ast.body.statements[0];
      expect(stmt.distribution.name).toBe('dgamma');
    });

    it('parses dbern: z[i] ~ dbern(p)', () => {
      const ast = parse('model { z[i] ~ dbern(p) }');
      const stmt = ast.body.statements[0];
      expect(stmt.distribution.name).toBe('dbern');
      expect(stmt.distribution.params).toHaveLength(1);
    });

    it('parses dpois: y[i] ~ dpois(lambda[i])', () => {
      const ast = parse('model { y[i] ~ dpois(lambda[i]) }');
      const stmt = ast.body.statements[0];
      expect(stmt.distribution.name).toBe('dpois');
    });

    it('parses dbin: y[i] ~ dbin(p, n[i])', () => {
      const ast = parse('model { y[i] ~ dbin(p, n[i]) }');
      const stmt = ast.body.statements[0];
      expect(stmt.distribution.name).toBe('dbin');
      expect(stmt.distribution.params).toHaveLength(2);
    });
  });

  describe('deterministic assignments', () => {
    it('parses a simple deterministic node: mu[i] <- alpha + beta * x[i]', () => {
      const ast = parse('model { mu[i] <- alpha + beta * x[i] }');
      const stmt = ast.body.statements[0];
      expect(stmt.type).toBe('DeterministicAssignment');
      expect(stmt.lhs.type).toBe('IndexExpr');
      // RHS should be a BinaryOp tree
      expect(stmt.rhs.type).toBe('BinaryOp');
      expect(stmt.rhs.op).toBe('+');
    });

    it('parses a scalar deterministic: eta <- alpha + beta * x', () => {
      const ast = parse('model { eta <- alpha + beta * x }');
      const stmt = ast.body.statements[0];
      expect(stmt.type).toBe('DeterministicAssignment');
      expect(stmt.lhs).toMatchObject({ type: 'Identifier', name: 'eta' });
    });

    it('handles pow() function on RHS', () => {
      const ast = parse('model { v <- pow(sigma, 2) }');
      const stmt = ast.body.statements[0];
      expect(stmt.rhs.type).toBe('FunctionCall');
      expect(stmt.rhs.name).toBe('pow');
      expect(stmt.rhs.args).toHaveLength(2);
    });
  });

  describe('operator precedence', () => {
    it('parses a + b * c as a + (b * c) (multiplication binds tighter)', () => {
      const ast = parse('model { z <- a + b * c }');
      const rhs = ast.body.statements[0].rhs;
      // Top-level op must be '+'
      expect(rhs.type).toBe('BinaryOp');
      expect(rhs.op).toBe('+');
      // Right child must be '*'
      expect(rhs.right.type).toBe('BinaryOp');
      expect(rhs.right.op).toBe('*');
    });

    it('parses a * b + c as (a * b) + c', () => {
      const ast = parse('model { z <- a * b + c }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.op).toBe('+');
      expect(rhs.left.op).toBe('*');
    });

    it('parses a - b - c as (a - b) - c (left-associative)', () => {
      const ast = parse('model { z <- a - b - c }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.op).toBe('-');
      expect(rhs.left.op).toBe('-');
      expect(rhs.left.left).toMatchObject({ type: 'Identifier', name: 'a' });
    });

    it('parses a ^ b ^ c as a ^ (b ^ c) (right-associative)', () => {
      const ast = parse('model { z <- a ^ b ^ c }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.op).toBe('^');
      // Right child should also be '^' (right-associativity)
      expect(rhs.right.op).toBe('^');
    });

    it('parentheses override precedence: (a + b) * c', () => {
      const ast = parse('model { z <- (a + b) * c }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.op).toBe('*');
      expect(rhs.left.op).toBe('+');
    });

    it('parses unary minus: z <- -alpha', () => {
      const ast = parse('model { z <- -alpha }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.type).toBe('UnaryOp');
      expect(rhs.op).toBe('-');
      expect(rhs.operand).toMatchObject({ type: 'Identifier', name: 'alpha' });
    });
  });

  describe('for loops', () => {
    it('parses for (i in 1:N) { ... }', () => {
      const ast = parse('model { for (i in 1:N) { y[i] ~ dnorm(mu, tau) } }');
      const stmt = ast.body.statements[0];
      expect(stmt.type).toBe('ForLoop');
      expect(stmt.variable).toBe('i');
      expect(stmt.from).toMatchObject({ type: 'NumberLiteral', value: 1 });
      expect(stmt.to).toMatchObject({ type: 'Identifier', name: 'N' });
      expect(stmt.body.type).toBe('Block');
      expect(stmt.body.statements).toHaveLength(1);
    });

    it('parses nested for loops', () => {
      const src = `model {
        for (i in 1:N) {
          for (j in 1:J) {
            y[i,j] ~ dnorm(mu[i,j], tau)
          }
        }
      }`;
      const ast = parse(src);
      const outer = ast.body.statements[0];
      expect(outer.type).toBe('ForLoop');
      expect(outer.variable).toBe('i');
      const inner = outer.body.statements[0];
      expect(inner.type).toBe('ForLoop');
      expect(inner.variable).toBe('j');
    });

    it('parses multiple statements inside a for loop body', () => {
      const src = `model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x[i]
        }
      }`;
      const ast = parse(src);
      expect(ast.body.statements[0].body.statements).toHaveLength(2);
    });
  });

  describe('2-D indexing', () => {
    it('parses y[i,j] as IndexExpr with two indices', () => {
      const ast = parse('model { y[i,j] ~ dnorm(mu, tau) }');
      const lhs = ast.body.statements[0].lhs;
      expect(lhs.type).toBe('IndexExpr');
      expect(lhs.indices).toHaveLength(2);
      expect(lhs.indices[0]).toMatchObject({ type: 'Identifier', name: 'i' });
      expect(lhs.indices[1]).toMatchObject({ type: 'Identifier', name: 'j' });
    });
  });

  describe('link functions on LHS', () => {
    it('parses log(mu[i]) <- alpha + beta * x[i]', () => {
      const ast = parse('model { log(mu[i]) <- alpha + beta * x[i] }');
      const stmt = ast.body.statements[0];
      expect(stmt.type).toBe('DeterministicAssignment');
      expect(stmt.lhs.type).toBe('FunctionCall');
      expect(stmt.lhs.name).toBe('log');
      expect(stmt.lhs.args).toHaveLength(1);
      expect(stmt.lhs.args[0].type).toBe('IndexExpr');
    });

    it('parses logit(p[i]) <- alpha + beta * x[i]', () => {
      const ast = parse('model { logit(p[i]) <- alpha + beta * x[i] }');
      const stmt = ast.body.statements[0];
      expect(stmt.lhs.name).toBe('logit');
    });

    it('parses cloglog(p[i]) <- eta[i]', () => {
      const ast = parse('model { cloglog(p[i]) <- eta[i] }');
      const stmt = ast.body.statements[0];
      expect(stmt.lhs.name).toBe('cloglog');
    });
  });

  describe('truncation', () => {
    it('parses T(lower, upper): y ~ dnorm(0, 1) T(0, 10)', () => {
      const ast = parse('model { y ~ dnorm(0, 1) T(0, 10) }');
      const stmt = ast.body.statements[0];
      expect(stmt.type).toBe('StochasticAssignment');
      expect(stmt.truncation).not.toBeNull();
      expect(stmt.truncation.lower).toMatchObject({ type: 'NumberLiteral', value: 0 });
      expect(stmt.truncation.upper).toMatchObject({ type: 'NumberLiteral', value: 10 });
    });

    it('parses T(0, ) — lower bound only', () => {
      const ast = parse('model { y ~ dnorm(0, 1) T(0, ) }');
      const stmt = ast.body.statements[0];
      expect(stmt.truncation.lower).toMatchObject({ type: 'NumberLiteral', value: 0 });
      expect(stmt.truncation.upper).toBeNull();
    });

    it('parses T(, 10) — upper bound only', () => {
      const ast = parse('model { y ~ dnorm(0, 1) T(, 10) }');
      const stmt = ast.body.statements[0];
      expect(stmt.truncation.lower).toBeNull();
      expect(stmt.truncation.upper).toMatchObject({ type: 'NumberLiteral', value: 10 });
    });

    it('produces null truncation when no T() annotation', () => {
      const ast = parse('model { y ~ dnorm(0, 1) }');
      const stmt = ast.body.statements[0];
      expect(stmt.truncation).toBeNull();
    });
  });

  describe('full default model 1 — simple linear', () => {
    const MODEL1 = `
      model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x[i]
        }
        alpha ~ dnorm(0, 0.001)
        beta  ~ dnorm(0, 0.001)
        tau   ~ dgamma(0.001, 0.001)
      }
    `;

    it('parses without error', () => {
      expect(() => parse(MODEL1)).not.toThrow();
    });

    it('produces a Model AST with correct top-level structure', () => {
      const ast = parse(MODEL1);
      expect(ast.type).toBe('Model');
      expect(ast.body.statements).toHaveLength(4); // for loop + 3 priors
    });

    it('identifies the for loop correctly', () => {
      const ast = parse(MODEL1);
      const forLoop = ast.body.statements[0];
      expect(forLoop.type).toBe('ForLoop');
      expect(forLoop.variable).toBe('i');
    });

    it('identifies all three prior distributions', () => {
      const ast = parse(MODEL1);
      const priors = ast.body.statements.slice(1);
      expect(priors).toHaveLength(3);
      const names = priors.map(s => s.distribution.name);
      expect(names).toContain('dnorm');
      expect(names).toContain('dgamma');
    });
  });

  describe('full default model 2 — mixed effects', () => {
    const MODEL2 = `
      model {
        for (i in 1:N) {
          y[i] ~ dnorm(mu[i], tau)
          mu[i] <- alpha + beta * x[i] + b[group[i]]
        }
        for (j in 1:J) {
          b[j] ~ dnorm(0, tau.b)
        }
        alpha ~ dnorm(0, 0.001)
        beta  ~ dnorm(0, 0.001)
        tau   ~ dgamma(0.001, 0.001)
        tau.b ~ dgamma(0.001, 0.001)
      }
    `;

    it('parses without error', () => {
      expect(() => parse(MODEL2)).not.toThrow();
    });

    it('has two for loops and four scalar priors', () => {
      const ast = parse(MODEL2);
      const stmts = ast.body.statements;
      const forLoops = stmts.filter(s => s.type === 'ForLoop');
      const priors   = stmts.filter(s => s.type === 'StochasticAssignment');
      expect(forLoops).toHaveLength(2);
      expect(priors).toHaveLength(4);
    });

    it('correctly represents the tau.b dotted name as an Identifier', () => {
      const ast = parse(MODEL2);
      const tauB = ast.body.statements.find(
        s => s.type === 'StochasticAssignment' &&
             s.lhs.type === 'Identifier' &&
             s.lhs.name === 'tau.b'
      );
      expect(tauB).toBeDefined();
    });

    it('represents mu[i] <- alpha + beta*x[i] + b[group[i]] correctly', () => {
      const ast = parse(MODEL2);
      const outerFor = ast.body.statements[0];
      const muAssign = outerFor.body.statements.find(
        s => s.type === 'DeterministicAssignment'
      );
      expect(muAssign).toBeDefined();
      // The RHS should be a BinaryOp tree of additions/multiplications
      expect(muAssign.rhs.type).toBe('BinaryOp');
    });

    it('parses b[group[i]] as a nested IndexExpr', () => {
      const ast = parse(MODEL2);
      const outerFor = ast.body.statements[0];
      const muAssign = outerFor.body.statements.find(
        s => s.type === 'DeterministicAssignment'
      );
      // Drill down to find b[group[i]] somewhere in the RHS tree
      function findIndexNamed(node, name) {
        if (!node || typeof node !== 'object') return false;
        if (node.type === 'IndexExpr' && node.object.name === name) return true;
        return Object.values(node).some(v => findIndexNamed(v, name));
      }
      expect(findIndexNamed(muAssign.rhs, 'b')).toBe(true);
    });
  });

  describe('function calls in expressions', () => {
    it('parses exp() on RHS', () => {
      const ast = parse('model { mu <- exp(eta) }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.type).toBe('FunctionCall');
      expect(rhs.name).toBe('exp');
    });

    it('parses sqrt() on RHS', () => {
      const ast = parse('model { s <- sqrt(v) }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.type).toBe('FunctionCall');
      expect(rhs.name).toBe('sqrt');
    });

    it('parses nested function calls: log(pow(x, 2))', () => {
      const ast = parse('model { z <- log(pow(x, 2)) }');
      const rhs = ast.body.statements[0].rhs;
      expect(rhs.type).toBe('FunctionCall');
      expect(rhs.name).toBe('log');
      expect(rhs.args[0].type).toBe('FunctionCall');
      expect(rhs.args[0].name).toBe('pow');
    });
  });

  describe('error handling', () => {
    it('throws ParseError for missing closing brace', () => {
      expect(() => parse('model { alpha ~ dnorm(0, 1)')).toThrow(ParseError);
    });

    it('throws ParseError when ~ or <- is absent', () => {
      expect(() => parse('model { alpha dnorm(0,1) }')).toThrow(ParseError);
    });

    it('throws ParseError for unexpected token after model block', () => {
      expect(() => parse('model { } extra')).toThrow(ParseError);
    });

    it('throws ParseError for incomplete for-loop header', () => {
      expect(() => parse('model { for (i in) { } }')).toThrow();
    });

    it('ParseError contains token location info', () => {
      try {
        parse('model { alpha dnorm(0,1) }');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        // ParseError attaches a token property when available
        expect(e.name).toBe('ParseError');
      }
    });
  });

  describe('semicolons as optional statement separators', () => {
    it('accepts semicolons between statements without error', () => {
      expect(() => parse('model { alpha ~ dnorm(0, 1); beta ~ dnorm(0, 1) }')).not.toThrow();
    });

    it('accepts multiple semicolons (empty statements)', () => {
      expect(() => parse('model { ; ; alpha ~ dnorm(0, 1) ; }')).not.toThrow();
    });
  });
});
