export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    const source = [
      "export class DurableObject {",
      "  constructor(ctx, env) { this.ctx = ctx; this.env = env; }",
      "}"
    ].join("\n");
    return {
      url: `data:text/javascript,${encodeURIComponent(source)}`,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
