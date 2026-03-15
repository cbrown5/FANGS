/**
 * Parser for BUGS/JAGS model syntax.
 *
 * Consumes the token array produced by `Lexer.tokenize()` and returns an AST
 * whose root is a `Model` node.
 *
 * AST node shapes
 * ───────────────
 * Model                { type:'Model',                   body:Block }
 * Block                { type:'Block',                   statements:Statement[] }
 * ForLoop              { type:'ForLoop',                 variable:string, from:Expr, to:Expr, body:Block }
 * StochasticAssignment { type:'StochasticAssignment',    lhs:Expr, distribution:Distribution, truncation?:{lower:Expr|null,upper:Expr|null} }
 * DeterministicAssignment { type:'DeterministicAssignment', lhs:Expr, rhs:Expr }
 * Distribution         { type:'Distribution',            name:string, params:Expr[] }
 * BinaryOp             { type:'BinaryOp',                op:string,   left:Expr, right:Expr }
 * UnaryOp              { type:'UnaryOp',                 op:string,   operand:Expr }
 * FunctionCall         { type:'FunctionCall',            name:string, args:Expr[] }
 * IndexExpr            { type:'IndexExpr',               object:Expr, indices:Expr[] }
 * Identifier           { type:'Identifier',              name:string }
 * NumberLiteral        { type:'NumberLiteral',           value:number }
 */

import { TokenType } from './lexer.js';

// ─── Error class ──────────────────────────────────────────────────────────────

export class ParseError extends Error {
  /**
   * @param {string} message
   * @param {{line:number,col:number}} [token]
   */
  constructor(message, token) {
    const loc = token ? ` (line ${token.line}, col ${token.col})` : '';
    super(`${message}${loc}`);
    this.name = 'ParseError';
    this.token = token;
  }
}

// ─── Operator precedence table ────────────────────────────────────────────────

/**
 * Binary operator precedence levels (higher = tighter binding).
 * Standard mathematical convention.
 */
const PRECEDENCE = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '^': 3,   // right-associative (handled specially)
};

// ─── Known BUGS distribution names ───────────────────────────────────────────

const DISTRIBUTIONS = new Set([
  'dnorm', 'dgamma', 'dunif', 'dbern', 'dpois',
  'dbin',  'dbeta',  'dlnorm', 'dexp', 'dt',
  'dchisqr', 'dweib', 'ddirich', 'dwish', 'dmnorm',
]);

// ─── Known BUGS/JAGS link-function names ─────────────────────────────────────
// These may appear on the LHS of a deterministic assignment, e.g. log(mu[i]) <- ...

const LINK_FUNCTIONS = new Set([
  'log', 'logit', 'cloglog', 'probit', 'exp', 'ilogit',
]);

// ─── Parser class ─────────────────────────────────────────────────────────────

export class Parser {
  /**
   * @param {Array<{type:string,value:*,line:number,col:number}>} tokens
   */
  constructor(tokens) {
    // Strip NEWLINE and COMMENT tokens — they carry no grammatical meaning here.
    // (They are retained in the token stream by the Lexer so that downstream
    //  tools can use them; the parser simply ignores them.)
    this._tokens = tokens.filter(
      t => t.type !== TokenType.NEWLINE && t.type !== TokenType.COMMENT
    );
    /** @type {number} – index of the current (not-yet-consumed) token */
    this._pos = 0;
  }

  // ── Token-stream utilities ──────────────────────────────────────────────────

  /** Return the current token without consuming it. */
  _peek() {
    return this._tokens[this._pos];
  }

  /** Return the token `offset` positions ahead without consuming anything. */
  _peekAhead(offset) {
    const idx = this._pos + offset;
    return idx < this._tokens.length ? this._tokens[idx] : null;
  }

  /**
   * Consume and return the current token.
   * Optionally assert that it has a specific type.
   * @param {string} [expectedType]
   * @returns {{type:string,value:*,line:number,col:number}}
   */
  _consume(expectedType) {
    const tok = this._tokens[this._pos];
    if (!tok) {
      throw new ParseError('Unexpected end of input');
    }
    if (expectedType !== undefined && tok.type !== expectedType) {
      throw new ParseError(
        `Expected token '${expectedType}' but got '${tok.type}' ('${tok.value}')`,
        tok
      );
    }
    this._pos++;
    return tok;
  }

  /**
   * Consume the current token only if it matches `type` (and optionally `value`).
   * Returns the token if matched, or null if not.
   * @param {string} type
   * @param {*} [value]
   * @returns {{type:string,value:*,line:number,col:number}|null}
   */
  _match(type, value) {
    const tok = this._peek();
    if (!tok || tok.type !== type) return null;
    if (value !== undefined && tok.value !== value) return null;
    return this._consume();
  }

  /**
   * Check whether the current token is an IDENTIFIER with the given name.
   * @param {string} name
   * @returns {boolean}
   */
  _isIdent(name) {
    const tok = this._peek();
    return tok && tok.type === TokenType.IDENTIFIER && tok.value === name;
  }

  /**
   * Throw a ParseError at the current token position.
   * @param {string} message
   */
  _error(message) {
    const tok = this._peek();
    throw new ParseError(message, tok);
  }

  // ── Top-level ───────────────────────────────────────────────────────────────

  /**
   * Parse the full source and return the Model AST node.
   * @returns {{type:'Model', body:object}}
   */
  parse() {
    // A BUGS source may optionally begin with a `model { ... }` wrapper.
    let body;
    if (this._peek() && this._peek().type === TokenType.MODEL) {
      this._consume(TokenType.MODEL);
      body = this._parseBlock();
    } else {
      // Treat the whole token stream as an implicit block.
      body = this._parseImplicitBlock();
    }

    // After the model block we may have trailing EOF.
    if (this._peek() && this._peek().type !== TokenType.EOF) {
      this._error(`Unexpected token '${this._peek().value}' after model block`);
    }

    return { type: 'Model', body };
  }

  // ── Block parsing ───────────────────────────────────────────────────────────

  /**
   * Parse `{ statement* }`.
   * @returns {{type:'Block', statements:object[]}}
   */
  _parseBlock() {
    this._consume(TokenType.LBRACE);
    const statements = [];
    while (this._peek() && this._peek().type !== TokenType.RBRACE && this._peek().type !== TokenType.EOF) {
      const stmt = this._parseStatement();
      if (stmt) statements.push(stmt);
    }
    this._consume(TokenType.RBRACE);
    return { type: 'Block', statements };
  }

  /**
   * Parse statements without surrounding braces (used when the `model` keyword
   * is absent and we treat the whole file as the body).
   * @returns {{type:'Block', statements:object[]}}
   */
  _parseImplicitBlock() {
    const statements = [];
    while (this._peek() && this._peek().type !== TokenType.EOF) {
      const stmt = this._parseStatement();
      if (stmt) statements.push(stmt);
    }
    return { type: 'Block', statements };
  }

  // ── Statement parsing ───────────────────────────────────────────────────────

  /**
   * Parse a single statement (for-loop, stochastic or deterministic assignment).
   * Semicolons between statements are accepted but not required.
   * @returns {object|null}
   */
  _parseStatement() {
    // Skip stray semicolons.
    while (this._match(TokenType.SEMICOLON)) { /* skip */ }

    const tok = this._peek();
    if (!tok || tok.type === TokenType.RBRACE || tok.type === TokenType.EOF) {
      return null;
    }

    // for ( ... ) { ... }
    if (tok.type === TokenType.FOR) {
      return this._parseForLoop();
    }

    // Everything else is an assignment.  We need to look ahead past the LHS to
    // decide whether it is stochastic (`~`) or deterministic (`<-`).
    return this._parseAssignment();
  }

  /**
   * Parse `for (variable in from:to) { ... }`.
   * @returns {{type:'ForLoop',...}}
   */
  _parseForLoop() {
    const forTok = this._consume(TokenType.FOR);
    this._consume(TokenType.LPAREN);

    const varTok = this._consume(TokenType.IDENTIFIER);
    const variable = varTok.value;

    this._consume(TokenType.IN);

    const from = this._parseExpression();

    this._consume(TokenType.COLON);

    const to = this._parseExpression();

    this._consume(TokenType.RPAREN);

    const body = this._parseBlock();

    return { type: 'ForLoop', variable, from, to, body };
  }

  /**
   * Parse either a stochastic or deterministic assignment.
   *
   * BUGS allows link-function calls on the LHS of deterministic assignments:
   *   log(mu[i])   <- linear.predictor
   *   logit(p[i])  <- linear.predictor
   *
   * The LHS is parsed as an expression, then we look for `~` or `<-`.
   * @returns {object}
   */
  _parseAssignment() {
    const lhs = this._parseLhs();

    const tok = this._peek();

    if (tok && tok.type === TokenType.TILDE) {
      // Stochastic: lhs ~ distribution T(...)
      this._consume(TokenType.TILDE);
      const distribution = this._parseDistribution();

      // Optional truncation T(lower, upper)
      let truncation = null;
      if (this._peek() && this._peek().type === TokenType.T) {
        truncation = this._parseTruncation();
      }

      return { type: 'StochasticAssignment', lhs, distribution, truncation };
    }

    if (tok && tok.type === TokenType.ARROW) {
      // Deterministic: lhs <- rhs
      this._consume(TokenType.ARROW);
      const rhs = this._parseExpression();
      return { type: 'DeterministicAssignment', lhs, rhs };
    }

    this._error(
      `Expected '~' or '<-' after left-hand side, got '${tok ? tok.value : 'EOF'}'`
    );
  }

  /**
   * Parse the left-hand side of an assignment.
   *
   * Valid LHS forms:
   *   identifier                 alpha
   *   indexed identifier         y[i]   mu[i,j]
   *   link-function call         log(mu[i])   logit(p[i])
   *
   * @returns {object} – Identifier, IndexExpr, or FunctionCall node
   */
  _parseLhs() {
    const tok = this._peek();

    // Might be a link-function: log(...) <-  or  logit(...) <-
    // We recognise this when an IDENTIFIER that names a link-function is
    // immediately followed by '('.
    if (
      tok &&
      tok.type === TokenType.IDENTIFIER &&
      LINK_FUNCTIONS.has(tok.value) &&
      this._peekAhead(1) &&
      this._peekAhead(1).type === TokenType.LPAREN
    ) {
      // Parse as a function call so the AST retains the link-function name.
      return this._parseFunctionCall();
    }

    // Otherwise parse a plain identifier, optionally indexed.
    return this._parsePrimaryNoCall();
  }

  // ── Distribution parsing ────────────────────────────────────────────────────

  /**
   * Parse a distribution: `dname(param, ...)`.
   * @returns {{type:'Distribution', name:string, params:object[]}}
   */
  _parseDistribution() {
    const nameTok = this._peek();
    if (!nameTok || nameTok.type !== TokenType.IDENTIFIER) {
      this._error(`Expected distribution name, got '${nameTok ? nameTok.value : 'EOF'}'`);
    }

    // Warn (but do not fail) on unknown distribution names so that the parser
    // remains forward-compatible.
    const name = nameTok.value;
    this._consume(TokenType.IDENTIFIER);

    this._consume(TokenType.LPAREN);
    const params = [];
    if (this._peek() && this._peek().type !== TokenType.RPAREN) {
      params.push(this._parseExpression());
      while (this._match(TokenType.COMMA)) {
        params.push(this._parseExpression());
      }
    }
    this._consume(TokenType.RPAREN);

    return { type: 'Distribution', name, params };
  }

  /**
   * Parse the truncation annotation `T(lower, upper)`.
   * Either bound may be omitted (e.g. `T(0,)` or `T(,10)`).
   * @returns {{lower:object|null, upper:object|null}}
   */
  _parseTruncation() {
    this._consume(TokenType.T);    // keyword T
    this._consume(TokenType.LPAREN);

    let lower = null;
    let upper = null;

    if (this._peek() && this._peek().type !== TokenType.COMMA) {
      lower = this._parseExpression();
    }

    this._consume(TokenType.COMMA);

    if (this._peek() && this._peek().type !== TokenType.RPAREN) {
      upper = this._parseExpression();
    }

    this._consume(TokenType.RPAREN);
    return { lower, upper };
  }

  // ── Expression parsing (Pratt / precedence climbing) ──────────────────────

  /**
   * Parse a full expression respecting operator precedence.
   * Entry point for the recursive-descent expression parser.
   * @param {number} [minPrec=0]
   * @returns {object}
   */
  _parseExpression(minPrec = 0) {
    let left = this._parseUnary();

    while (true) {
      const tok = this._peek();
      if (!tok) break;

      // Only IDENTIFIER tokens can be binary operators at this point.
      if (tok.type !== TokenType.IDENTIFIER) break;

      const prec = PRECEDENCE[tok.value];
      if (prec === undefined || prec <= minPrec) break;

      // `^` is right-associative: recurse with the same precedence level.
      const op = tok.value;
      this._consume();
      const right = this._parseExpression(op === '^' ? prec - 1 : prec);
      left = { type: 'BinaryOp', op, left, right };
    }

    return left;
  }

  /**
   * Parse a unary expression (currently only unary minus).
   * @returns {object}
   */
  _parseUnary() {
    if (this._isIdent('-')) {
      this._consume(); // consume '-'
      const operand = this._parseUnary();
      return { type: 'UnaryOp', op: '-', operand };
    }
    if (this._isIdent('+')) {
      this._consume(); // consume '+' (no-op but valid)
      return this._parseUnary();
    }
    return this._parsePower();
  }

  /**
   * `^` has highest binary precedence but we handle it inside _parseExpression
   * with right-associativity.  This level simply delegates to primary.
   */
  _parsePower() {
    return this._parsePrimary();
  }

  /**
   * Parse a primary expression: literal, identifier, function call, indexed
   * expression, or parenthesised expression.
   * @returns {object}
   */
  _parsePrimary() {
    const tok = this._peek();
    if (!tok) this._error('Unexpected end of input in expression');

    // Parenthesised expression
    if (tok.type === TokenType.LPAREN) {
      this._consume(TokenType.LPAREN);
      const expr = this._parseExpression();
      this._consume(TokenType.RPAREN);
      return expr;
    }

    // Number literal
    if (tok.type === TokenType.NUMBER) {
      this._consume();
      return { type: 'NumberLiteral', value: tok.value };
    }

    // Identifier, function call, or indexed expression
    if (tok.type === TokenType.IDENTIFIER) {
      return this._parseIdentOrCall();
    }

    this._error(`Unexpected token '${tok.value}' in expression`);
  }

  /**
   * Like `_parsePrimary` but never treats an identifier as a function call.
   * Used when parsing the LHS of an assignment where we know we have a plain
   * name or indexed name (not a distribution or function).
   * @returns {object}
   */
  _parsePrimaryNoCall() {
    const tok = this._peek();
    if (!tok) this._error('Unexpected end of input on left-hand side');

    if (tok.type === TokenType.NUMBER) {
      this._consume();
      return { type: 'NumberLiteral', value: tok.value };
    }

    if (tok.type === TokenType.LPAREN) {
      this._consume(TokenType.LPAREN);
      const expr = this._parseExpression();
      this._consume(TokenType.RPAREN);
      return expr;
    }

    if (tok.type === TokenType.IDENTIFIER) {
      this._consume();
      const base = { type: 'Identifier', name: tok.value };

      // Optional indexing: name[i]  or  name[i,j]
      if (this._peek() && this._peek().type === TokenType.LBRACKET) {
        return this._parseIndexing(base);
      }

      return base;
    }

    this._error(`Expected identifier on left-hand side, got '${tok.value}'`);
  }

  /**
   * Parse an identifier that may be followed by `(` (function call) or `[`
   * (array indexing), or neither.
   * @returns {object}
   */
  _parseIdentOrCall() {
    const nameTok = this._consume(TokenType.IDENTIFIER);
    const name = nameTok.value;

    // Function call: name(args...)
    if (this._peek() && this._peek().type === TokenType.LPAREN) {
      this._consume(TokenType.LPAREN);
      const args = [];
      if (this._peek() && this._peek().type !== TokenType.RPAREN) {
        args.push(this._parseExpression());
        while (this._match(TokenType.COMMA)) {
          args.push(this._parseExpression());
        }
      }
      this._consume(TokenType.RPAREN);
      const callNode = { type: 'FunctionCall', name, args };

      // A function call result can itself be indexed (rare in BUGS but allowed).
      if (this._peek() && this._peek().type === TokenType.LBRACKET) {
        return this._parseIndexing(callNode);
      }
      return callNode;
    }

    const base = { type: 'Identifier', name };

    // Array indexing: name[i]  or  name[i,j]
    if (this._peek() && this._peek().type === TokenType.LBRACKET) {
      return this._parseIndexing(base);
    }

    return base;
  }

  /**
   * Parse a function call where we have already confirmed the identifier is a
   * link function. Delegates to `_parseIdentOrCall` which handles the `(...)`.
   * This method is only called when `_peek()` is the function-name token.
   * @returns {{type:'FunctionCall', name:string, args:object[]}}
   */
  _parseFunctionCall() {
    return /** @type {any} */ (this._parseIdentOrCall());
  }

  /**
   * Parse one or more index dimensions: `[i]`, `[i, j]`, `[i, j, k]`.
   * @param {object} object – the AST node being indexed
   * @returns {{type:'IndexExpr', object:object, indices:object[]}}
   */
  _parseIndexing(object) {
    this._consume(TokenType.LBRACKET);
    const indices = [];

    // An index slot may be empty (meaning "all"), represented as null.
    indices.push(this._parseIndexSlot());

    while (this._match(TokenType.COMMA)) {
      indices.push(this._parseIndexSlot());
    }

    this._consume(TokenType.RBRACKET);
    return { type: 'IndexExpr', object, indices };
  }

  /**
   * Parse a single index, which is an expression.
   * @returns {object}
   */
  _parseIndexSlot() {
    return this._parseExpression();
  }
}
