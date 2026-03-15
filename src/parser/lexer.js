/**
 * Lexer for BUGS/JAGS model syntax.
 *
 * Converts a raw source string into a flat array of tokens. Each token has the
 * shape: { type: string, value: string|number, line: number, col: number }
 *
 * Token types
 * -----------
 * NUMBER       – integer or floating-point literal
 * STRING       – double-quoted string literal
 * IDENTIFIER   – bare name, possibly containing dots (tau.b, mu.0)
 * TILDE        – ~
 * ARROW        – <-
 * LPAREN       – (
 * RPAREN       – )
 * LBRACKET     – [
 * RBRACKET     – ]
 * LBRACE       – {
 * RBRACE       – }
 * COMMA        – ,
 * COLON        – :
 * SEMICOLON    – ;
 * NEWLINE      – \n  (preserved so that callers can use them for error context)
 * COMMENT      – # … to end of line
 * FOR          – keyword `for`
 * IN           – keyword `in`
 * MODEL        – keyword `model`
 * T            – keyword `T`  (truncation marker)
 * EOF          – end of input
 */

// ─── Token type constants ─────────────────────────────────────────────────────

export const TokenType = Object.freeze({
  NUMBER:     'NUMBER',
  STRING:     'STRING',
  IDENTIFIER: 'IDENTIFIER',
  TILDE:      'TILDE',
  ARROW:      'ARROW',
  LPAREN:     'LPAREN',
  RPAREN:     'RPAREN',
  LBRACKET:   'LBRACKET',
  RBRACKET:   'RBRACKET',
  LBRACE:     'LBRACE',
  RBRACE:     'RBRACE',
  COMMA:      'COMMA',
  COLON:      'COLON',
  SEMICOLON:  'SEMICOLON',
  NEWLINE:    'NEWLINE',
  COMMENT:    'COMMENT',
  FOR:        'FOR',
  IN:         'IN',
  MODEL:      'MODEL',
  T:          'T',
  EOF:        'EOF',
});

// Keywords that get their own token type instead of IDENTIFIER.
const KEYWORDS = {
  model: TokenType.MODEL,
  for:   TokenType.FOR,
  in:    TokenType.IN,
  T:     TokenType.T,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Returns true if `ch` is an ASCII digit.
 * @param {string} ch
 * @returns {boolean}
 */
function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

/**
 * Returns true if `ch` can start an identifier (letter or underscore).
 * @param {string} ch
 * @returns {boolean}
 */
function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

/**
 * Returns true if `ch` can continue an identifier (letter, digit, underscore,
 * or dot – BUGS allows dots in names like `tau.b`).
 * @param {string} ch
 * @returns {boolean}
 */
function isIdentPart(ch) {
  return isIdentStart(ch) || isDigit(ch) || ch === '.';
}

// ─── Lexer class ──────────────────────────────────────────────────────────────

export class Lexer {
  /**
   * @param {string} source – complete BUGS/JAGS model source text
   */
  constructor(source) {
    /** @type {string} */
    this._src = source;
    /** @type {number} – current read position in `_src` */
    this._pos = 0;
    /** @type {number} – 1-based line counter */
    this._line = 1;
    /** @type {number} – 1-based column counter (column of `_pos`) */
    this._col = 1;
    /** @type {Array<{type:string,value:*,line:number,col:number}>} */
    this._tokens = [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Peek at the character at the current position without consuming it. */
  _peek(offset = 0) {
    return this._src[this._pos + offset];
  }

  /** Consume and return the current character, advancing position/line/col. */
  _advance() {
    const ch = this._src[this._pos++];
    if (ch === '\n') {
      this._line++;
      this._col = 1;
    } else {
      this._col++;
    }
    return ch;
  }

  /**
   * Build and push a token.
   * @param {string} type
   * @param {string|number} value
   * @param {number} line – line where the token starts
   * @param {number} col  – column where the token starts
   */
  _emit(type, value, line, col) {
    this._tokens.push({ type, value, line, col });
  }

  /**
   * Throw a LexError with position information included.
   * @param {string} message
   */
  _error(message) {
    throw new LexError(`${message} (line ${this._line}, col ${this._col})`);
  }

  // ── Scanning methods ────────────────────────────────────────────────────────

  /** Skip horizontal whitespace (spaces and tabs). */
  _skipWhitespace() {
    while (this._pos < this._src.length) {
      const ch = this._peek();
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this._advance();
      } else {
        break;
      }
    }
  }

  /** Scan a comment from `#` to end-of-line (exclusive of the newline). */
  _scanComment(line, col) {
    // Consume '#'
    this._advance();
    let text = '#';
    while (this._pos < this._src.length && this._peek() !== '\n') {
      text += this._advance();
    }
    this._emit(TokenType.COMMENT, text, line, col);
  }

  /** Scan a numeric literal (integer or float, optional scientific notation). */
  _scanNumber(line, col) {
    let raw = '';

    // Leading digits
    while (this._pos < this._src.length && isDigit(this._peek())) {
      raw += this._advance();
    }

    // Optional decimal part
    if (this._peek() === '.' && isDigit(this._peek(1))) {
      raw += this._advance(); // consume '.'
      while (this._pos < this._src.length && isDigit(this._peek())) {
        raw += this._advance();
      }
    }

    // Optional exponent
    if (this._peek() === 'e' || this._peek() === 'E') {
      const nextCh = this._peek(1);
      if (isDigit(nextCh) || nextCh === '+' || nextCh === '-') {
        raw += this._advance(); // consume 'e'/'E'
        if (this._peek() === '+' || this._peek() === '-') {
          raw += this._advance();
        }
        if (!isDigit(this._peek())) {
          this._error(`Expected digits after exponent in numeric literal, got '${this._peek()}'`);
        }
        while (this._pos < this._src.length && isDigit(this._peek())) {
          raw += this._advance();
        }
      }
    }

    this._emit(TokenType.NUMBER, Number(raw), line, col);
  }

  /** Scan a double-quoted string literal. */
  _scanString(line, col) {
    this._advance(); // consume opening '"'
    let text = '';
    while (this._pos < this._src.length) {
      const ch = this._peek();
      if (ch === '"') {
        this._advance(); // consume closing '"'
        this._emit(TokenType.STRING, text, line, col);
        return;
      }
      if (ch === '\n') {
        this._error('Unterminated string literal');
      }
      if (ch === '\\') {
        this._advance(); // consume '\'
        const escaped = this._advance();
        switch (escaped) {
          case 'n':  text += '\n'; break;
          case 't':  text += '\t'; break;
          case '"':  text += '"';  break;
          case '\\': text += '\\'; break;
          default:   text += escaped;
        }
      } else {
        text += this._advance();
      }
    }
    this._error('Unterminated string literal');
  }

  /**
   * Scan an identifier or keyword.
   * BUGS identifiers may contain letters, digits, underscores, and dots.
   * A trailing dot is not allowed (it would be ambiguous), so we consume dots
   * only when they are followed by an identifier-start or digit character.
   */
  _scanIdentifier(line, col) {
    let name = this._advance(); // first character (already validated as ident-start)

    while (this._pos < this._src.length) {
      const ch = this._peek();
      if (ch === '.') {
        // Only consume the dot if the next character continues the identifier.
        const next = this._peek(1);
        if (next !== undefined && isIdentPart(next)) {
          name += this._advance(); // consume '.'
          name += this._advance(); // consume the character after the dot
        } else {
          break;
        }
      } else if (isIdentPart(ch)) {
        name += this._advance();
      } else {
        break;
      }
    }

    // Distinguish keywords from plain identifiers.
    const kwType = KEYWORDS[name];
    if (kwType !== undefined) {
      this._emit(kwType, name, line, col);
    } else {
      this._emit(TokenType.IDENTIFIER, name, line, col);
    }
  }

  // ── Main tokenise loop ──────────────────────────────────────────────────────

  /**
   * Tokenise the full source string.
   * @returns {Array<{type:string,value:*,line:number,col:number}>}
   */
  tokenize() {
    this._tokens = [];
    this._pos  = 0;
    this._line = 1;
    this._col  = 1;

    while (this._pos < this._src.length) {
      // Skip spaces/tabs between tokens (newlines are emitted as tokens).
      this._skipWhitespace();
      if (this._pos >= this._src.length) break;

      const ch   = this._peek();
      const line = this._line;
      const col  = this._col;

      // ── Newline ──────────────────────────────────────────────────────────
      if (ch === '\n') {
        this._advance();
        this._emit(TokenType.NEWLINE, '\n', line, col);
        continue;
      }

      // ── Comment ──────────────────────────────────────────────────────────
      if (ch === '#') {
        this._scanComment(line, col);
        continue;
      }

      // ── Two-character operators ───────────────────────────────────────────
      if (ch === '<' && this._peek(1) === '-') {
        this._advance(); this._advance();
        this._emit(TokenType.ARROW, '<-', line, col);
        continue;
      }

      // ── Single-character punctuation ─────────────────────────────────────
      switch (ch) {
        case '~': this._advance(); this._emit(TokenType.TILDE,     '~', line, col); continue;
        case '(': this._advance(); this._emit(TokenType.LPAREN,    '(', line, col); continue;
        case ')': this._advance(); this._emit(TokenType.RPAREN,    ')', line, col); continue;
        case '[': this._advance(); this._emit(TokenType.LBRACKET,  '[', line, col); continue;
        case ']': this._advance(); this._emit(TokenType.RBRACKET,  ']', line, col); continue;
        case '{': this._advance(); this._emit(TokenType.LBRACE,    '{', line, col); continue;
        case '}': this._advance(); this._emit(TokenType.RBRACE,    '}', line, col); continue;
        case ',': this._advance(); this._emit(TokenType.COMMA,     ',', line, col); continue;
        case ':': this._advance(); this._emit(TokenType.COLON,     ':', line, col); continue;
        case ';': this._advance(); this._emit(TokenType.SEMICOLON, ';', line, col); continue;
        // Arithmetic operators are NOT lexed into their own token type here;
        // the parser will read them directly from IDENTIFIER/NUMBER context.
        // But we do need to emit them so the parser can see them.
        case '+': this._advance(); this._emit(TokenType.IDENTIFIER, '+', line, col); continue;
        case '-': this._advance(); this._emit(TokenType.IDENTIFIER, '-', line, col); continue;
        case '*': this._advance(); this._emit(TokenType.IDENTIFIER, '*', line, col); continue;
        case '/': this._advance(); this._emit(TokenType.IDENTIFIER, '/', line, col); continue;
        case '^': this._advance(); this._emit(TokenType.IDENTIFIER, '^', line, col); continue;
        default: break;
      }

      // ── Numeric literal ──────────────────────────────────────────────────
      if (isDigit(ch)) {
        this._scanNumber(line, col);
        continue;
      }

      // ── Decimal-leading float (.5) ───────────────────────────────────────
      if (ch === '.' && isDigit(this._peek(1))) {
        // Prepend a zero so _scanNumber works uniformly.
        // We manually construct the token to avoid mutating _src.
        let raw = '0.';
        this._advance(); // consume '.'
        while (this._pos < this._src.length && isDigit(this._peek())) {
          raw += this._advance();
        }
        this._emit(TokenType.NUMBER, Number(raw), line, col);
        continue;
      }

      // ── String literal ───────────────────────────────────────────────────
      if (ch === '"') {
        this._scanString(line, col);
        continue;
      }

      // ── Identifier / keyword ─────────────────────────────────────────────
      if (isIdentStart(ch)) {
        this._scanIdentifier(line, col);
        continue;
      }

      // ── Unknown character ────────────────────────────────────────────────
      this._error(`Unexpected character '${ch}'`);
    }

    // Always end with an EOF sentinel.
    this._emit(TokenType.EOF, null, this._line, this._col);
    return this._tokens;
  }
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class LexError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LexError';
  }
}
