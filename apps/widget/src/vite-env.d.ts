/// <reference types="vite/client" />

/**
 * `?inline` CSS imports resolve to a string. Vite's own client types cover
 * `*.css` as a side-effect import but not the inline query, which is what
 * `element.ts` uses to get the stylesheet into the shadow root.
 */
declare module "*.css?inline" {
  const css: string;
  // eslint-disable-next-line no-restricted-syntax -- Vite emits a default export
  export default css;
}
