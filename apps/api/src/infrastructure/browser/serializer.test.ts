import type { Page } from "@cloudflare/puppeteer";
import {
  formatPageState,
  serializePage,
  SERIALIZE_SCRIPT,
} from "./serializer";
import type { PageState } from "./types";

const fixture: PageState = {
  url: "https://shop.example.com/cart?session=secret&locale=en#payment",
  title: "Your cart",
  scrollY: 440,
  scrollHeight: 2100,
  innerHeight: 900,
  elements: [
    {
      i: 0,
      tag: "button",
      type: null,
      text: "Add to cart",
      aria: null,
      href: null,
      inViewport: true,
    },
    {
      i: 1,
      tag: "input",
      type: "email",
      text: "",
      aria: "Email address",
      href: null,
      inViewport: true,
    },
    {
      i: 2,
      tag: "a",
      type: null,
      text: "Shipping policy",
      aria: "Read shipping policy",
      href: "shop.example.com/policies/shipping",
      inViewport: false,
    },
  ],
  textDigest: "Two items Subtotal €42 Continue to checkout",
};

describe("browser DOM serializer", () => {
  it("formats a compact, sanitized page-state snapshot for the model", () => {
    expect(formatPageState(fixture)).toMatchInlineSnapshot(`
      "URL: https://shop.example.com
      Title: Your cart
      Scroll: 440/2100 (viewport 900)
      Interactive elements (visible-first, [index] <tag> \"text\"):
      [0] <button> \"Add to cart\"
      [1] <input:email> \"\" (aria: Email address)
      [2] <a> \"Shipping policy\" (aria: Read shipping policy, href: shop.example.com/policies/shipping)
      Page text: Two items Subtotal €42 Continue to checkout"
    `);
  });

  it("exports self-contained function source that compiles without a DOM", () => {
    const compile = new Function(`return (${SERIALIZE_SCRIPT})`);

    expect(compile()).toBeTypeOf("function");
    expect(SERIALIZE_SCRIPT).toContain("const MAX_ELEMENTS = 150");
    expect(SERIALIZE_SCRIPT).toContain('removeAttribute("data-zg-idx")');
    expect(SERIALIZE_SCRIPT).toContain('.slice(0, 1500)');
  });

  it("executes the source in the page and returns its state", async () => {
    const evaluate = vi.fn().mockResolvedValue(fixture);
    const page = { evaluate } as unknown as Page;

    await expect(serializePage(page)).resolves.toBe(fixture);
    expect(evaluate).toHaveBeenCalledWith(`(${SERIALIZE_SCRIPT})()`);
  });
});
