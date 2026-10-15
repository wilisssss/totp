import { describe, expect, it } from "vitest";

import {
  base64FromDataUrl,
  classifyDropText,
  collectDropTexts,
  firstUriListEntry,
  imageSrcFromHtml,
  pickDropTextPayload,
  type DragDataLike,
} from "./qr-drop";

/** Fake DataTransfer: only `getData` matters for the parsing logic. */
function dragData(entries: Record<string, string>): DragDataLike {
  return {
    getData: (type: string) => entries[type] ?? "",
  };
}

describe("base64FromDataUrl", () => {
  it("extracts the base64 body of an image data URL", () => {
    expect(base64FromDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe("iVBORw0KGgo=");
  });

  it("tolerates surrounding whitespace and line breaks", () => {
    expect(base64FromDataUrl("  data:image/jpeg;base64,AB\nCD  ")).toBe("ABCD");
  });

  it("rejects non-image and non-base64 data URLs", () => {
    expect(base64FromDataUrl("data:text/html;base64,PGI+")).toBeNull();
    expect(base64FromDataUrl("data:image/svg+xml,<svg/>")).toBeNull();
    expect(base64FromDataUrl("data:image/png;base64,")).toBeNull();
    expect(base64FromDataUrl("otpauth://totp/x")).toBeNull();
  });
});

describe("imageSrcFromHtml", () => {
  it("extracts the src of the first img tag", () => {
    expect(imageSrcFromHtml('<div><img src="data:image/png;base64,AA=="></div>')).toBe(
      "data:image/png;base64,AA==",
    );
    expect(imageSrcFromHtml("<img alt='qr' src='https://a/qr.png'>")).toBe("https://a/qr.png");
  });

  it("returns empty for html without an image", () => {
    expect(imageSrcFromHtml("<p>otpauth://totp/x</p>")).toBe("");
    expect(imageSrcFromHtml("")).toBe("");
  });
});

describe("firstUriListEntry", () => {
  it("skips comments and picks the first entry", () => {
    expect(firstUriListEntry("# komentar\r\nhttps://a/qr.png\r\nhttps://b/x.png")).toBe(
      "https://a/qr.png",
    );
  });

  it("returns empty for a comment-only list", () => {
    expect(firstUriListEntry("# satu\n# dua")).toBe("");
  });
});

describe("classifyDropText", () => {
  it("classifies image data URLs", () => {
    expect(classifyDropText("data:image/png;base64,iVBORw0KGgo=")).toEqual({
      kind: "image",
      base64: "iVBORw0KGgo=",
    });
  });

  it("classifies otpauth URIs (both flavours)", () => {
    expect(classifyDropText("otpauth://totp/GitHub:a@b?secret=JBSW")).toEqual({
      kind: "uri",
      text: "otpauth://totp/GitHub:a@b?secret=JBSW",
    });
    expect(classifyDropText("otpauth-migration://offline?data=CgA=")).toEqual({
      kind: "uri",
      text: "otpauth-migration://offline?data=CgA=",
    });
  });

  it("classifies http(s) image URLs", () => {
    expect(classifyDropText("https://contoh.id/qr.png")).toEqual({
      kind: "url",
      url: "https://contoh.id/qr.png",
    });
  });

  it("classifies file:// URIs as paths (percent-decoded)", () => {
    expect(classifyDropText("file:///home/u/gambar%20qr.png")).toEqual({
      kind: "path",
      path: "/home/u/gambar qr.png",
    });
  });

  it("classifies bare filesystem paths", () => {
    expect(classifyDropText("/home/u/qr.png")).toEqual({
      kind: "path",
      path: "/home/u/qr.png",
    });
    expect(classifyDropText("C:\\Users\\u\\qr.png")).toEqual({
      kind: "path",
      path: "C:\\Users\\u\\qr.png",
    });
  });

  it("rejects non-importable payloads", () => {
    expect(classifyDropText("")).toBeNull();
    expect(classifyDropText("javascript:alert(1)")).toBeNull();
    expect(classifyDropText("teks biasa tanpa URI")).toBeNull();
  });
});

describe("collectDropTexts", () => {
  it("reads uri-list, plain and html in priority order without duplicates", () => {
    const texts = collectDropTexts(
      dragData({
        "text/uri-list": "https://a/qr.png",
        "text/plain": "https://a/qr.png",
        "text/html": '<img src="data:image/png;base64,AA==">',
      }),
    );
    expect(texts).toEqual(["https://a/qr.png", "data:image/png;base64,AA=="]);
  });

  it("returns an empty list for an empty drag", () => {
    expect(collectDropTexts(dragData({}))).toEqual([]);
  });

  it("never throws when getData is restricted", () => {
    expect(
      collectDropTexts({
        getData: () => {
          throw new Error("DataError");
        },
      }),
    ).toEqual([]);
  });
});

describe("pickDropTextPayload", () => {
  it("prefers an image data URL from text/html over a page link", () => {
    expect(
      pickDropTextPayload(
        dragData({
          "text/uri-list": "https://contoh.id/halaman",
          "text/html": '<img src="data:image/png;base64,iVBORw0KGgo=">',
        }),
      ),
    ).toEqual({ kind: "image", base64: "iVBORw0KGgo=" });
  });

  it("falls back to a remote image URL", () => {
    expect(pickDropTextPayload(dragData({ "text/plain": "https://contoh.id/qr.png" }))).toEqual(
      { kind: "url", url: "https://contoh.id/qr.png" },
    );
  });

  it("returns null when nothing is importable", () => {
    expect(pickDropTextPayload(dragData({ "text/plain": "halo dunia" }))).toBeNull();
  });
});
