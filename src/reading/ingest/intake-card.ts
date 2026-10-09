// The card a link intake draws in the door conversation (topic-intake.ts). The
// payload names the intake and nothing that changes: where the intake stands is
// read off its record every time the card is drawn, so a conversation opened
// again tomorrow shows it as it is and not as it was when the card went up.

export interface IntakeCard {
  kind: "link-intake";
  intakeId: string;
  /**
   * The topic Lumen suggested when it raised the card, by id. Absent when the
   * model named none; the card then marks the program's own suggestion.
   */
  suggestedTopicId?: string;
}
