import express, { type RequestHandler } from 'express';
import { MIMEType } from 'node:util';

export const JSON_BODY_LIMIT = 10 * 1024 * 1024;

type Frame =
  | { kind: 'object'; state: 'first' | 'key' | 'colon' | 'value' | 'after'; keys: Set<string> }
  | { kind: 'array'; state: 'first' | 'value' | 'after' };

function malformed(): never {
  // Native JSON.parse errors can quote body contents; never forward those to the logger.
  throw Object.assign(new SyntaxError('Malformed JSON'), { status: 400 });
}

/** Validate tokens before object parsing collapses keys. Stack-based to preserve deep valid JSON. */
function assertUnambiguous(source: string): void {
  let i = 0;
  const stack: Frame[] = [];
  const space = () => { while (' \t\r\n'.includes(source[i]) && i < source.length) i++; };
  const digit = (c: string) => c >= '0' && c <= '9';
  const hex = (c: string) => digit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
  const string = (): string => {
    const start = i;
    if (source[i++] !== '"') malformed();
    while (i < source.length) {
      const c = source[i++];
      if (c === '"') return source.slice(start,i);
      if (c.charCodeAt(0) < 0x20) malformed();
      if (c !== '\\') continue;
      const escape = source[i++];
      if (escape === 'u') {
        for (let n=0;n<4;n++) if (!hex(source[i++])) malformed();
      } else if (!escape || !'"\\/bfnrt'.includes(escape)) malformed();
    }
    return malformed();
  };
  const number = () => {
    if (source[i] === '-') i++;
    if (source[i] === '0') i++;
    else {
      if (!(source[i] >= '1' && source[i] <= '9')) malformed();
      while (digit(source[i])) i++;
    }
    if (source[i] === '.') {
      i++; if (!digit(source[i])) malformed();
      while (digit(source[i])) i++;
    }
    if (source[i] === 'e' || source[i] === 'E') {
      i++; if (source[i] === '+' || source[i] === '-') i++;
      if (!digit(source[i])) malformed();
      while (digit(source[i])) i++;
    }
  };
  const value = () => {
    const c = source[i];
    if (c === '{') { i++; stack.push({kind:'object',state:'first',keys:new Set()}); }
    else if (c === '[') { i++; stack.push({kind:'array',state:'first'}); }
    else if (c === '"') string();
    else if (c === '-' || digit(c)) number();
    else {
      const literal = ['true','false','null'].find(word=>source.startsWith(word,i));
      if (!literal) malformed();
      i += literal.length;
    }
  };

  space();
  if (source[i] !== '{' && source[i] !== '[') malformed(); // Preserve express.json strict roots.
  value();
  while (stack.length) {
    space();
    const frame = stack[stack.length-1];
    const close = frame.kind === 'object' ? '}' : ']';
    if (frame.state === 'after') {
      if (source[i] === close) { i++; stack.pop(); }
      else if (source[i++] === ',') frame.state = frame.kind === 'object' ? 'key' : 'value';
      else malformed();
    } else if (frame.state === 'first' && source[i] === close) {
      i++; stack.pop();
    } else if (frame.kind === 'object' && (frame.state === 'first' || frame.state === 'key')) {
      // Parse only the string token, never an object: escaped equivalent keys compare identically.
      const key: string = JSON.parse(string());
      if (frame.keys.has(key)) throw Object.assign(new Error('Duplicate JSON object key'), {
        status:400,code:'json.duplicate_key',
      });
      frame.keys.add(key); frame.state = 'colon';
    } else if (frame.kind === 'object' && frame.state === 'colon') {
      if (source[i++] !== ':') malformed();
      frame.state = 'value';
    } else {
      frame.state = 'after'; value();
    }
  }
  space();
  if (i !== source.length) malformed();
}

// Reuse Express's bounded reader, decompression and charset decoding, but retain text until
// duplicate detection finishes. A verify hook's Buffer would require a second charset decoder.
const readJsonText = express.text({ type:'application/json',limit:JSON_BODY_LIMIT });
export const jsonInput: RequestHandler = (req,res,next) => {
  readJsonText(req,res,error=>{
    if (error) { next(error); return; }
    if (typeof req.body !== 'string') { next(); return; }
    let charset = 'utf-8';
    try { charset = new MIMEType(req.get('content-type')!).params.get('charset')?.toLowerCase() || charset; }
    catch { /* Match Express's default charset for an unparseable Content-Type. */ }
    if (!charset.startsWith('utf-')) {
      next(Object.assign(new Error('Unsupported JSON charset'),{status:415})); return;
    }
    try {
      if (req.body.length === 0) req.body = {};
      else { assertUnambiguous(req.body); req.body = JSON.parse(req.body); }
    } catch (error) {
      req.body = {}; // Do not retain rejected input or attach body/key text to errors.
      next(error instanceof SyntaxError ? Object.assign(new SyntaxError('Malformed JSON'),{status:400}) : error); return;
    }
    next();
  });
};
