// Copyright 2021 Kitson P. Kelly. All rights reserved. MIT License.

import { assert } from "https://deno.land/std@0.100.0/testing/asserts.ts";
import type {} from "./types.d.ts";

Deno.test({
  name: "globals defined",
  async fn() {
    assert(globalThis.XMLHttpRequest == undefined);
    assert(globalThis.XMLHttpRequestEventTarget == undefined);
    assert(globalThis.XMLHttpRequestUpload == undefined);
    await import("./mod.ts");
    assert(typeof XMLHttpRequest === "function");
    assert(typeof XMLHttpRequestEventTarget === "function");
    assert(typeof XMLHttpRequestUpload === "function");
  },
});
