// Where a topic card gets its cover images. What it returns is a data: URI
// (nothing to revoke) rendered to a fixed width, so the card crops it with
// object-fit rather than asking for its size; the first pass over a book has to
// hash it before it can cache, which is why the loading state on a card is a
// state a user actually sees and not a flicker.

export { coverUrl } from "../../../reading/covers";
