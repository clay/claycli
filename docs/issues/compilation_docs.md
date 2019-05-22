---
id: compilation_docs
title: Server & Client Service Compilation Docs
sidebar_label: Server & Client Service Compilation Docs
---


## Issue

Question from the [issue 120](https://github.com/clay/claycli/issues/120)

A question came up about services for server/client and the following example of an error message:

```
Error: A server-side only service must have a client-side counterpart (while requireTransform was processing /<PATH>/app/components/<COMPONENT>/model.js) while parsing file: /<PATH>/app/components/<COMPONENT>/model.js
```

## Explanation

The `model.js` is a [isomorphic](https://en.wikipedia.org/wiki/Isomorphic_JavaScript) file; this means that the first request is handled by the server
and the subsequent requests are handled by the client. So if we reference a file on the server we will expect to be able to do the same on the browser. 

An example will be the `Base64` encoding where a `Nodejs` server need to use the [Buffer](https://nodejs.org/api/buffer.html) on the browser it will need to use the [atob](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/atob)/[btoa](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/btoa) functions.

In our case if the `model.js` reference a `services/server` file on the server then we will expect to do the same thing on the browser but in compilation time we point to the `services/client` version of the file but sometimes these files work on both environments we put in the `service/universal`. 

As a final example on the `model.js`, we can target directly to the database on the server but on the client, we need a different approach because we don't have the same ability as the server so we perform a request to obtain our data.

The error that originates this issue tell us that we have a reference to a `services/server` but doesn't have the `services/client` reference when compiled.
