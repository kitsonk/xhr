// Copyright 2021-2025 Kitson P. Kelly. All rights reserved. MIT License.

// deno-lint-ignore-file no-explicit-any

/**
 * Provides a polyfill for Deno CLI and Deploy for
 * [`XMLHttpRequest`](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest)
 * (_XHR_).
 *
 * When loaded, it will inject `XMLHttpRequest` into the global namespace along
 * with a couple other key objects.
 *
 * While the module exports `XMLHttpRequest`, most use cases it should just be
 * imported _before_ any other dependencies that require XHR to be present:
 *
 * ```ts
 * import "jsr:/@kitsonk/xhr";
 * import * as lib from "https://other/dependency/that/needs/xhr/lib.js";
 * ```
 *
 * This polyfill has several known/intentional limitations from a browser
 * standard `XMLHttpRequest`:
 *
 * - It does not handle XML, though the name implies it, nor does it handle HTML
 *   being treated as a response type `"document"`. This uses the browser's
 *   built in parser to parse the XML and HTML into a DOM object.
 * - Sync is not supported (passing `false` to the `async` argument). Most
 *   browsers have deprecated it in the main thread. Since this polyfill works
 *   by calling Deno's `fetch()` it is nearly impossible to generate a sync
 *   version, plus it is a really bad idea to block a thread while waiting for a
 *   server response. **Don't do it, don't use software that requires it.**
 *
 * @module
 */

import { contentType, getCharset } from "jsr:/@std/media-types@^1.1";

type XMLHttpRequestResponseType =
  | ""
  | "arraybuffer"
  | "blob"
  | "document"
  | "json"
  | "text";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) {
    const err = new Error(msg);
    err.name = "AssertionError";
    throw err;
  }
}

function extractLength(response: Response) {
  const values = response.headers.get("content-length")?.split(/\s*,\s*/) ?? [];
  let candidateValue: string | null = null;
  for (const value of values) {
    if (candidateValue == null) {
      candidateValue = value;
    } else if (value !== candidateValue) {
      throw new Error("invalid content-length");
    }
  }
  if (candidateValue == "" || candidateValue == null) {
    return null;
  }
  const v = parseInt(candidateValue, 10);
  return Number.isNaN(v) ? null : v;
}

function getEssence(value: string) {
  return value.split(/\s*;\s*/)[0];
}

function extractMIMEType(headers: Headers) {
  let mimeType: string | null = null;
  const values = headers.get("content-type")?.split(/\s*,\s*/);
  if (!values) {
    throw new Error("missing content type");
  }
  for (const value of values) {
    const temporaryMimeType = contentType(value);
    if (!temporaryMimeType || getEssence(temporaryMimeType) === "*/*") {
      continue;
    }
    mimeType = temporaryMimeType;
  }
  if (mimeType == null) {
    throw new Error("missing content type");
  }
  return mimeType;
}

function isHTMLMIMEType(value: string) {
  return getEssence(value) === "text/html";
}

function isXMLMIMEType(value: string) {
  const essence = getEssence(value);
  return essence.endsWith("+xml") || essence === "text/xml" ||
    essence === "application/xml";
}

const decoder = new TextDecoder();

function parseJSONFromBytes(value: Uint8Array): any {
  const string = decoder.decode(value);
  return JSON.parse(string);
}

function appendBytes<AB extends ArrayBufferLike = ArrayBuffer>(
  ...bytes: Uint8Array<AB>[]
): Uint8Array<AB> {
  let length = 0;
  for (const b of bytes) {
    length += b.length;
  }
  const result = new Uint8Array(length) as Uint8Array<AB>;
  let offset = 0;
  for (const b of bytes) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
}

/**
 * The interface for event handlers for {@linkcode XMLHttpRequest} and
 * {@lincode XMLHttpRequestUpload}.
 */
export class XMLHttpRequestEventTarget extends EventTarget {
  onabort: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
  onerror: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
  onload: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
  onloadend: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
  onloadstart: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
  onprogress: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;
  ontimeout: ((this: XMLHttpRequest, ev: ProgressEvent) => any) | null = null;

  override dispatchEvent(evt: Event): boolean {
    if (evt instanceof ProgressEvent) {
      const xhr: XMLHttpRequest = this as any;
      switch (evt.type) {
        case "abort":
          if (this.onabort) {
            this.onabort.call(xhr, evt);
          }
          break;
        case "error":
          if (this.onerror) {
            this.onerror.call(xhr, evt);
          }
          break;
        case "load":
          if (this.onload) {
            this.onload.call(xhr, evt);
          }
          break;
        case "loadend":
          if (this.onloadend) {
            this.onloadend.call(xhr, evt);
          }
          break;
        case "loadstart":
          if (this.onloadstart) {
            this.onloadstart.call(xhr, evt);
          }
          break;
        case "progress":
          if (this.onprogress) {
            this.onprogress.call(xhr, evt);
          }
          break;
        case "timeout":
          if (this.ontimeout) {
            this.ontimeout.call(xhr, evt);
          }
      }
    }
    if (evt.cancelable && evt.defaultPrevented) {
      return false;
    } else {
      return super.dispatchEvent(evt);
    }
  }
}

/**
 * Represents the upload process for a specific {@linkcode XMLHttpRequest}. It
 * is an _opaque_ object that represents the underlying, runtime-dependent,
 * upload process. It is an {@linkcode XMLHttpRequestEventTarget} and can be
 * obtained by calling `XMLHttpRequest.upload`.
 */
export class XMLHttpRequestUpload extends XMLHttpRequestEventTarget {
}

enum State {
  UNSENT = 0,
  OPENED = 1,
  HEADERS_RECEIVED = 2,
  LOADING = 3,
  DONE = 4,
}

const NORMALIZED_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "DELETE",
  "OPTIONS",
  "PUT",
  "PATCH",
];
const FORBIDDEN_METHODS = ["CONNECT", "TRACE", "TRACK"];

function isForbidden(method: string): boolean {
  return FORBIDDEN_METHODS.includes(method.toUpperCase());
}

function normalize(method: string): string {
  return NORMALIZED_METHODS.find((m) => m === method.toUpperCase()) ?? method;
}

/**
 * XMLHttpRequest (XHR) objects are used to interact with servers. You can
 * retrieve data from a URL without having to do a full page refresh. This
 * enables a Web page to update just part of a page without disrupting what the
 * user is doing.
 *
 * Despite its name, XMLHttpRequest can be used to retrieve any type of data,
 * not just XML.
 */
export class XMLHttpRequest extends XMLHttpRequestEventTarget {
  #abortedFlag = false;
  #abortController?: AbortController;
  #crossOriginCredentials = false;
  #headers = new Headers();
  #mime?: string;
  #receivedBytes = new Uint8Array();
  #requestMethod?: string;
  #response?: Response;
  #responseObject: any = null;
  #responseType: XMLHttpRequestResponseType = "";
  #sendFlag = false;
  #state = State.UNSENT;
  #timedoutFlag = false;
  #timeout = 0;
  #upload = new XMLHttpRequestUpload();
  #uploadCompleteFlag = false;
  #uploadListener = false;
  #url?: URL;

  #getResponseMIMEType() {
    try {
      assert(this.#response);
      const mimeType = extractMIMEType(this.#response.headers);
      return mimeType;
    } catch {
      return "text/xml";
    }
  }

  #getFinalMIMEType() {
    if (!this.#mime) {
      return this.#getResponseMIMEType();
    } else {
      return this.#mime;
    }
  }

  #getFinalEncoding() {
    return getCharset(this.#getFinalMIMEType())?.toLocaleLowerCase() ?? null;
  }

  #getTextResponse() {
    if (this.#response?.body == null) {
      return "";
    }
    let charset = this.#getFinalEncoding();
    if (
      this.#responseType === "" && charset == null &&
      isXMLMIMEType(this.#getFinalMIMEType())
    ) {
      charset = "utf-8";
    }
    charset = charset ?? "utf8";
    const decoder = new TextDecoder(charset);
    return decoder.decode(this.#receivedBytes);
  }

  #handleResponseEndOfBody() {
    assert(this.#response);
    const loaded = this.#receivedBytes.length;
    const total = extractLength(this.#response) ?? 0;
    this.dispatchEvent(new ProgressEvent("progress", { loaded, total }));
    this.#state = State.DONE;
    this.#sendFlag = false;
    this.dispatchEvent(new Event("readystatechange"));
    this.dispatchEvent(new ProgressEvent("load", { loaded, total }));
    this.dispatchEvent(new ProgressEvent("loadend", { loaded, total }));
  }

  #handleErrors() {
    if (!this.#sendFlag) {
      return;
    }
    if (this.#timedoutFlag) {
      this.#requestErrorSteps("timeout");
    } else if (this.#abortedFlag) {
      this.#requestErrorSteps("abort");
    } else {
      this.#requestErrorSteps("error");
    }
  }

  #requestErrorSteps(event: string) {
    this.#state = State.DONE;
    this.#sendFlag = false;
    this.dispatchEvent(new Event("readystatechange"));
    if (!this.#uploadCompleteFlag) {
      this.#uploadCompleteFlag = true;
      if (this.#uploadListener) {
        this.#upload.dispatchEvent(
          new ProgressEvent(event, { loaded: 0, total: 0 }),
        );
        this.#upload.dispatchEvent(
          new ProgressEvent("loadend", { loaded: 0, total: 0 }),
        );
      }
    }
    this.dispatchEvent(new ProgressEvent(event, { loaded: 0, total: 0 }));
    this.dispatchEvent(new ProgressEvent("loadend", { loaded: 0, total: 0 }));
  }

  #setDocumentResponse() {
    assert(this.#response);
    if (this.#response.body == null) {
      return;
    }
    const finalMIME = this.#getFinalMIMEType();
    if (!(isHTMLMIMEType(finalMIME) || isXMLMIMEType(finalMIME))) {
      return;
    }
    if (this.#responseType === "" && isHTMLMIMEType(finalMIME)) {
      return;
    }
    this.#responseObject = new DOMException(
      "Document bodies are not supported",
      "SyntaxError",
    );
  }

  #terminate() {
    if (this.#abortController) {
      try {
        this.#abortController.abort();
      } catch {
        // just swallowing errors here
      }
      this.#abortController = undefined;
    }
  }

  onreadystatechange: ((this: XMLHttpRequest, ev: Event) => any) | null = null;

  get readyState(): number {
    return this.#state;
  }

  get response(): any {
    if (this.#responseType === "" || this.#responseType === "text") {
      if (!(this.#state === State.LOADING || this.#state === State.DONE)) {
        return "";
      }
      return this.#getTextResponse();
    }
    if (this.#state !== State.DONE) {
      return null;
    }
    if (this.#responseObject instanceof Error) {
      return null;
    }
    if (this.#responseObject != null) {
      return this.#responseObject;
    }
    if (this.#responseType === "arraybuffer") {
      try {
        this.#responseObject = this.#receivedBytes.buffer.slice(
          this.#receivedBytes.byteOffset,
          this.#receivedBytes.byteLength + this.#receivedBytes.byteOffset,
        );
      } catch (e) {
        this.#responseObject = e;
        return null;
      }
    } else if (this.#responseType === "blob") {
      this.#responseObject = new Blob([this.#receivedBytes], {
        type: this.#getFinalMIMEType(),
      });
    } else if (this.#responseType === "document") {
      this.#setDocumentResponse();
    } else {
      assert(this.#responseType === "json");
      if (this.#response?.body == null) {
        return null;
      }
      let jsonObject;
      try {
        jsonObject = parseJSONFromBytes(this.#receivedBytes);
      } catch {
        return null;
      }
      this.#responseObject = jsonObject;
    }
    return this.#responseObject instanceof Error ? null : this.#responseObject;
  }

  get responseText(): string {
    if (!(this.#responseType === "" || this.#responseType === "text")) {
      throw new DOMException(
        "Response type is not set properly",
        "InvalidStateError",
      );
    }
    if (!(this.#state === State.LOADING || this.#state === State.DONE)) {
      return "";
    }
    return this.#getTextResponse();
  }

  get responseType(): XMLHttpRequestResponseType {
    return this.#responseType;
  }

  set responseType(value: XMLHttpRequestResponseType) {
    if (value === "document") {
      return;
    }
    if (this.#state === State.LOADING || this.#state === State.DONE) {
      throw new DOMException(
        "The response type cannot be changed when loading or done",
        "InvalidStateError",
      );
    }
    this.#responseType = value;
  }

  get responseURL(): string {
    return this.#response?.url ?? "";
  }

  get responseXML(): null {
    if (!(this.#responseType === "" || this.#responseType === "document")) {
      throw new DOMException(
        "Response type is not properly set",
        "InvalidStateError",
      );
    }
    if (this.#state !== State.DONE) {
      return null;
    }
    if (this.#setDocumentResponse instanceof Error) {
      return null;
    }
    this.#setDocumentResponse();
    return null;
  }

  get status(): number {
    return this.#response?.status ?? 0;
  }

  get statusText(): string {
    return this.#response?.statusText ?? "";
  }

  get timeout(): number {
    return this.#timeout;
  }

  set timeout(value: number) {
    this.#timeout = value;
  }

  get upload(): XMLHttpRequestUpload {
    return this.#upload;
  }

  get withCredentials(): boolean {
    return this.#crossOriginCredentials;
  }

  set withCredentials(value: boolean) {
    if (
      !(this.#state === State.UNSENT || this.#state === State.OPENED)
    ) {
      throw new DOMException(
        "The request is not unsent or opened",
        "InvalidStateError",
      );
    }
    if (this.#sendFlag) {
      throw new DOMException("The request has been sent", "InvalidStateError");
    }
    this.#crossOriginCredentials = value;
  }

  abort(): void {
    this.#terminate();
    if (
      (this.#state === State.OPENED && this.#sendFlag) ||
      this.#state === State.HEADERS_RECEIVED ||
      this.#state === State.LOADING
    ) {
      this.#requestErrorSteps("abort");
    }
    if (this.#state === State.DONE) {
      this.#state = State.UNSENT;
      this.#response = undefined;
    }
  }

  override dispatchEvent(evt: Event): boolean {
    switch (evt.type) {
      case "readystatechange":
        if (this.onreadystatechange) {
          this.onreadystatechange.call(this, evt);
        }
        break;
    }
    if (evt.cancelable && evt.defaultPrevented) {
      return false;
    } else {
      return super.dispatchEvent(evt);
    }
  }

  getAllResponseHeaders(): string | null {
    if (!this.#response) {
      return null;
    }
    const headers = [...this.#response.headers];
    headers.sort(([a], [b]) => a.localeCompare(b));
    return headers.map(([key, value]) => `${key}: ${value}`).join("\r\n");
  }

  getResponseHeader(name: string): string | null {
    return this.#response?.headers.get(name) ?? null;
  }

  open(
    method: string,
    url: string,
    async = true,
    username: string | null = null,
    password: string | null = null,
  ): void {
    if (typeof method !== "string") {
      throw new DOMException("The method is invalid", "SyntaxError");
    }
    if (isForbidden(method)) {
      throw new DOMException(
        `The method "${method}" is forbidden.`,
        "SecurityError",
      );
    }
    method = normalize(method);
    let parsedUrl: URL;
    try {
      let base: string | undefined;
      try {
        base = globalThis.location.toString();
      } catch {
        // we just want to avoid the error about location in Deno
      }
      parsedUrl = new URL(url, base);
    } catch {
      throw new DOMException(`The url "${url}" is invalid.`, "SyntaxError");
    }
    if (username != null) {
      parsedUrl.username = username;
    }
    if (password != null) {
      parsedUrl.password = password;
    }
    if (async === false) {
      throw new DOMException(
        "The polyfill does not support sync operation.",
        "InvalidAccessError",
      );
    }
    this.#terminate();
    this.#sendFlag = false;
    this.#uploadListener = false;
    this.#requestMethod = method;
    this.#url = parsedUrl;
    this.#headers = new Headers();
    this.#response = undefined;
    this.#state = State.OPENED;
    this.dispatchEvent(new Event("readystatechange"));
  }

  overrideMimeType(mime: string): void {
    if (this.#state === State.LOADING || this.#state === State.DONE) {
      throw new DOMException(
        "The request is in an invalid state",
        "InvalidStateError",
      );
    }
    this.#mime = contentType(mime) ?? "application/octet-stream";
  }

  send(body: BodyInit | null = null): void {
    if (this.#state !== State.OPENED) {
      throw new DOMException("Invalid state", "InvalidStateError");
    }
    if (this.#sendFlag) {
      throw new DOMException("Invalid state", "InvalidStateError");
    }
    if (this.#requestMethod === "GET" || this.#requestMethod === "HEAD") {
      body = null;
    }
    const abortController = this.#abortController = new AbortController();
    const req = new Request(this.#url!.toString(), {
      method: this.#requestMethod,
      headers: this.#headers,
      body,
      mode: "cors",
      credentials: this.#crossOriginCredentials ? "include" : "same-origin",
      signal: abortController.signal,
    });
    this.#uploadCompleteFlag = false;
    this.#timedoutFlag = false;
    if (req.body == null) {
      this.#uploadCompleteFlag = true;
    }
    this.#sendFlag = true;

    this.dispatchEvent(new ProgressEvent("loadstart", { loaded: 0, total: 0 }));
    this.#upload.dispatchEvent(
      new ProgressEvent("loadstart", { loaded: 0, total: 0 }),
    );
    if (this.#state !== State.OPENED || !this.#sendFlag) {
      return;
    }
    const processRequestEndOfBody = () => {
      this.#uploadCompleteFlag = true;
      if (!this.#uploadListener) {
        return;
      }
      this.#upload.dispatchEvent(
        new ProgressEvent("progress", { loaded: 0, total: 0 }),
      );
      this.#upload.dispatchEvent(
        new ProgressEvent("load", {
          loaded: 0,
          total: 0,
        }),
      );
      this.#upload.dispatchEvent(
        new ProgressEvent("loadend", { loaded: 0, total: 0 }),
      );
    };
    const processResponse = async (response: Response) => {
      this.#response = response;
      this.#state = State.HEADERS_RECEIVED;
      this.dispatchEvent(new Event("readystatechange"));
      if (this.#state !== State.HEADERS_RECEIVED) {
        return;
      }
      if (response.body == null) {
        this.#handleResponseEndOfBody();
        return;
      }
      const total = extractLength(this.#response) ?? 0;
      const processBodyChunk = (bytes: Uint8Array<ArrayBuffer>) => {
        this.#receivedBytes = appendBytes(this.#receivedBytes, bytes);
        // the specification indicates that this should return if last invoked
        // was <= 50ms ago, the problem is that often chunks arrive under that
        // and a client doesn't get a progress event, which then causes it to
        // "hang" when long polling
        if (this.#state === State.HEADERS_RECEIVED) {
          this.#state = State.LOADING;
        }
        this.dispatchEvent(new Event("readystatechange"));
        this.dispatchEvent(
          new ProgressEvent("progress", {
            loaded: this.#receivedBytes.length,
            total,
          }),
        );
      };
      const processEndOfBody = () => {
        this.#handleResponseEndOfBody();
      };
      const processBodyError = () => {
        this.#handleErrors();
      };
      try {
        for await (const bytes of response.body) {
          processBodyChunk(bytes as Uint8Array<ArrayBuffer>);
        }
        processEndOfBody();
      } catch {
        processBodyError();
      }
    };
    const processRejection = () => {
      this.#handleErrors();
    };
    const p = fetch(req).then((response) => {
      processRequestEndOfBody();
      return processResponse(response);
    }).catch(processRejection);
    if (this.#timeout > 0) {
      let tid = -1;
      const t = new Promise<boolean>((res) => {
        tid = setTimeout(() => res(true), this.#timeout);
      });
      Promise.race([p, t]).then((value) => {
        clearTimeout(tid);
        if (value) {
          this.#timedoutFlag = true;
          this.#terminate();
        }
      });
    }
  }

  setRequestHeader(name: string, value: string): void {
    if (this.#state !== State.OPENED) {
      throw new DOMException("Invalid state", "InvalidStateError");
    }
    if (this.#sendFlag) {
      throw new DOMException("Invalid state", "InvalidateStateError");
    }
    this.#headers.append(name, value);
  }

  get DONE(): State.DONE {
    return State.DONE;
  }

  get HEADERS_RECEIVED(): State.HEADERS_RECEIVED {
    return State.HEADERS_RECEIVED;
  }

  get LOADING(): State.LOADING {
    return State.LOADING;
  }

  get OPENED(): State.OPENED {
    return State.OPENED;
  }

  get UNSENT(): State.UNSENT {
    return State.UNSENT;
  }

  static get DONE(): State.DONE {
    return State.DONE;
  }

  static get HEADERS_RECEIVED(): State.HEADERS_RECEIVED {
    return State.HEADERS_RECEIVED;
  }

  static get LOADING(): State.LOADING {
    return State.LOADING;
  }

  static get OPENED(): State.OPENED {
    return State.OPENED;
  }

  static get UNSENT(): State.UNSENT {
    return State.UNSENT;
  }
}

// deno-lint-ignore ban-types
function maybeDefine(value: Function, name: string, scope: object) {
  Object.defineProperty(value, "name", {
    value: name,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  if (!(name in globalThis)) {
    Object.defineProperty(scope, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

maybeDefine(XMLHttpRequest, "XMLHttpRequest", globalThis);
maybeDefine(XMLHttpRequestEventTarget, "XMLHttpRequestEventTarget", globalThis);
maybeDefine(XMLHttpRequestUpload, "XMLHttpRequestUpload", globalThis);
