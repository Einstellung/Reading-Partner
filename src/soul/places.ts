// The one tool that moves the reader (docs/67): the soul takes them to a place,
// and the desk becomes whatever is there.
//
// The map is not written anywhere in the system prompt. It is the tool's own
// description, built when the turn is assembled out of what the shell has
// registered (src/desk/places.ts), so a shell that grows a screen teaches the
// model about it by registering one more line — and the anchored reading desk's
// prompt stays the byte-identical text docs/09 pins.
//
// An introduction is the same tool read out loud: the reader asks what is here,
// and the sentences are already in front of the model. Nothing else is needed
// for the soul to show a first-time reader around, which is what this replaces.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import { listPlaces, type Place } from "../desk";

export const GO_TO_TOOL = "go_to";

function ids(places: readonly Place[]): string {
  return places.map((p) => p.id).join(", ");
}

/** The tool's description: what going somewhere does, then the map itself. */
export function placesDescription(places: readonly Place[]): string {
  return (
    "Take the reader to one of the places in this app. Where you go, the desk changes: " +
    "what is in front of you afterwards is what that place holds. Go when the reader asks " +
    "to be taken somewhere, and when showing them a place answers them better than " +
    "describing it. These are the places, and what each is for:\n" +
    places.map((p) => `- ${p.id}: ${p.about}`).join("\n")
  );
}

/**
 * The place tool for one turn, or nothing at all where no shell has registered
 * a place: a headless run — a test, a legion errand — has nowhere to take a
 * reader, and a tool whose description lists no places is a tool the model can
 * only fail with.
 *
 * The description is fixed when the turn is assembled; the going is looked up
 * when the tool is called, so a reader taken somewhere mid-turn arrives through
 * the callbacks the shell holds now rather than the ones it held at assembly.
 */
export function buildPlaceTools(): AgentTool[] {
  const mounted = listPlaces();
  if (mounted.length === 0) return [];
  return [
    {
      name: GO_TO_TOOL,
      description: placesDescription(mounted),
      parameters: Type.Object({
        place: Type.String({ description: `Where to go: one of ${ids(mounted)}.` }),
      }),
      execute: async (args) => {
        const asked = String(args.place ?? "");
        const places = listPlaces();
        const place = places.find((p) => p.id === asked);
        if (!place) {
          return `No place named "${asked}"; the places are: ${ids(places)}.`;
        }
        await place.go();
        return `Went to ${place.id}.`;
      },
    },
  ];
}
