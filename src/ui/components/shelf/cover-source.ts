// Where a library card gets its cover image and the name under the title. The
// image is a data: URI (nothing to revoke) rendered to a fixed width, so the
// card asks the image what shape it is rather than assuming one; the first pass
// over a book has to hash it before it can cache, which is why the loading state
// on a card is a state a user actually sees and not a flicker.

export { bookCover, type BookCover } from "../../../reading/covers";
