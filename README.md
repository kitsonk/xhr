# xhr

[![oak ci](https://github.com/kitsonk/xhr/workflows/ci/badge.svg)](https://github.com/kitsonk/xhr)

![Custom badge](https://img.shields.io/endpoint?url=https%3A%2F%2Fdeno-visualizer.danopia.net%2Fshields%2Fdep-count%2Fx%2Fxhr%2Fmod.ts)
![Custom badge](https://img.shields.io/endpoint?url=https%3A%2F%2Fdeno-visualizer.danopia.net%2Fshields%2Fupdates%2Fx%2Fxhr%2Fmod.ts)

A `XMLHttpRequest` polyfill for [Deno CLI](https://deno.land/) and
[Deno Deploy](https://deno.com/deploy/). The main intent is to make code written
for a browser that uses `XMLHttpRequest` to fetch JSON, bytes, or text
asynchronously work with Deno.

> ⚠️ At this stage, this polyfill is very experimental and is not well tested.
> USE AT YOUR OWN RISK. Bug reports are welcome.

This polyfill has several known/intentional limitations from a browser standard
`XMLHttpRequest`:

- It does not handle XML, though the name implies it, nor does it handle HTML
  being treated as a response type `"document"`. This uses the browser's built
  in parser to parse the XML and HTML into a DOM object.
- Sync is not supported (passing `false` to the `async` argument). Most browsers
  have deprecated it in the main thread. Since this polyfill works by calling
  Deno's `fetch()` it is nearly impossible to generate a sync version, plus it
  is a really bad idea to block a thread while waiting for a server response.
  **Don't do it, don't use software that requires it.**

## Usage

Import the module. The module will analyze the global scope, and if
`XMLHttpRequest` and its associated APIs are not defined, it will add them:

```ts
import "https://deno.land/x/xhr@0.1.0/mod.ts";
```

Now, `XMLHttpRequest` should be available in the global scope.

## Types

The built in types for Deno do not include the `XMLHttpRequest` and associated
types, so if you are type checking your code and get errors about them not being
defined, there are a couple of solutions. If your code is generally written for
the browser, you might want to consider
[Targeting Deno and the Browser](https://deno.land/manual@v1.11.4/typescript/configuration#targeting-deno-and-the-browser)
section of the Deno Manual.

If all you want to do is "polyfill" the types, they are available here under
`./types.d.ts`. You can either import them like:

```ts
import type {} from "https://deno.land/x/xhr/0.1.0/types.d.ts";
```

Or if you are using Deno 1.12 or later, you can use the triple-slash directive
like:

```ts
/// <reference types="https://deno.land/x/xhr/0.1.0/types.d.ts" />
```

---

Copyright 2021 Kitson P. Kelly. All rights reserved.
