/** esbuild loads `.css` imports as text so the panel stylesheet can be a real
 * file while still ending up inside the shadow root. */
declare module "*.css" {
  const css: string;
  export default css;
}
