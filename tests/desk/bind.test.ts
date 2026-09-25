import { expect, test } from "bun:test";
import { bindItemTools } from "../../src/desk";

test("only refs of the named kind get the tools", () => {
  const tools = async () => [];
  const out = bindItemTools(
    [
      { kind: "a", ref: { x: 1 } },
      { kind: "b", ref: { y: 2 } },
    ],
    "a",
    tools,
  );
  expect(out).toEqual([
    { kind: "a", ref: { x: 1, tools } },
    { kind: "b", ref: { y: 2 } },
  ]);
});

test("bindings for two kinds compose and leave the input alone", () => {
  const first = async () => [];
  const second = async () => [];
  const refs = [
    { kind: "a", ref: { x: 1 } },
    { kind: "b", ref: { y: 2 } },
  ];
  const out = bindItemTools(bindItemTools(refs, "a", first), "b", second);
  expect(out[0]!.ref).toEqual({ x: 1, tools: first });
  expect(out[1]!.ref).toEqual({ y: 2, tools: second });
  expect(refs[0]!.ref).toEqual({ x: 1 });
});
