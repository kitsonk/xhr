// Copyright 2021-2024 Kitson P. Kelly. All rights reserved. MIT License.

/// <reference types="./globals.d.ts" />

import { assert } from "jsr:@std/assert@0.215/assert";
import { assertThrows } from "jsr:@std/assert@0.215/assert_throws";

import "./mod.ts";

Deno.test({
  name: "globals defined",
  fn() {
    assert(typeof XMLHttpRequest === "function");
    assert(typeof XMLHttpRequestEventTarget === "function");
    assert(typeof XMLHttpRequestUpload === "function");
  },
});

Deno.test({
  name: "forbidden methods",
  fn() {
    const xhr = new XMLHttpRequest();
    assertThrows(
      () => {
        xhr.open("TRACE", "http://127.0.0.1");
      },
      DOMException,
      `The method "TRACE" is forbidden.`,
    );
  },
});

Deno.test({
  name: "non-standard methods work",
  fn() {
    const xhr = new XMLHttpRequest();
    xhr.open("CHICKEN", "http://127.0.0.1");
    xhr.abort();
  },
});
