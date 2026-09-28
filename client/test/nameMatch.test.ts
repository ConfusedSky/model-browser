import { describe, expect, it } from "vitest";
import { matchesTerms, queryTerms } from "../../shared/nameMatch";

const model = (name: string, extra: object = {}) => ({
  name,
  kind: "model" as const,
  ...extra,
});
const dir = (name: string, extra: object = {}) => ({
  name,
  kind: "dir" as const,
  ...extra,
});
const matches = (
  text: string,
  subject: Parameters<typeof matchesTerms>[1],
  folderMatching = true,
) => matchesTerms(queryTerms(text), subject, folderMatching);

describe("queryTerms", () => {
  it("trims, splits on runs of whitespace and lower-cases", () => {
    expect(queryTerms("  Young   Bronze ")).toEqual(["young", "bronze"]);
  });

  it("reads empty and whitespace-only text as no query", () => {
    expect(queryTerms("")).toEqual([]);
    expect(queryTerms("  \t ")).toEqual([]);
  });

  it("keeps separators and punctuation inside a term", () => {
    expect(queryTerms("young_bronze")).toEqual(["young_bronze"]);
    expect(queryTerms("D&D")).toEqual(["d&d"]);
  });
});

describe("matchesTerms", () => {
  const dragon = model("Bronze_Dragon_2832574/Young_Bronze_Dragon.stl");
  const paladin = model("DD_minis_945822/paladin.stl", {
    ancestorNames: ["D&D minis"],
  });

  it("matches terms in any order", () => {
    expect(matches("Young Bronze", dragon)).toBe(true);
    expect(matches("Bronze Young", dragon)).toBe(true);
  });

  it("reads a separator inside a term literally", () => {
    expect(matches("young_bronze", model("Young_Bronze_Dragon.stl"))).toBe(
      true,
    );
    expect(matches("young_bronze", model("Young-Bronze.stl"))).toBe(false);
  });

  it("requires every term", () => {
    expect(matches("bronze paladin", model("Bronze_Dragon/x.stl"))).toBe(false);
    expect(matches("bronze paladin", model("minis/paladin.stl"))).toBe(false);
  });

  it("skips the slots of folders with no stored name", () => {
    const deep = model("kit/sub/paladin.stl", {
      ancestorNames: ["D&D minis", null],
    });
    expect(matches("d&d sub paladin", deep)).toBe(true);
    expect(matches("null", deep)).toBe(false);
  });

  it("lets terms split across a stored name along the path and the file name", () => {
    expect(matches("d&d paladin", paladin)).toBe(true);
    expect(matches("d&d paladin", model("DD_minis_945822/paladin.stl"))).toBe(
      false,
    );
  });

  it("matches a container's own display name", () => {
    expect(
      matches(
        "d&d minis",
        dir("a/DD_minis_945822", { displayName: "D&D minis" }),
      ),
    ).toBe(true);
  });

  it("matches a container on its own names only, a model on its path", () => {
    expect(matches("kit bases", dir("Kit/bases"))).toBe(false);
    expect(matches("kit bases", model("Kit/bases/round.stl"))).toBe(true);
  });

  it("with folder matching off, ignores the names along the path", () => {
    expect(matches("d&d paladin", paladin, false)).toBe(false);
    expect(matches("paladin", paladin, false)).toBe(true);
  });

  it("never lets a term span two names", () => {
    expect(
      matches(
        "minis/pal",
        model("x/paladin.stl", { ancestorNames: ["D&D minis"] }),
      ),
    ).toBe(false);
  });
});
