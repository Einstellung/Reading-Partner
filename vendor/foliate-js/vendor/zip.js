// Stub. See ../unsupported.js. Unzipping is fflate, called from src/reading/epub,
// not zip.js called from foliate's makeBook().
import { unsupported } from '../unsupported.js'
export const configure = () => unsupported('zip.js')
export class ZipReader {
    constructor() { unsupported('zip.js') }
}
export class BlobReader {
    constructor() { unsupported('zip.js') }
}
export class TextWriter {
    constructor() { unsupported('zip.js') }
}
export class BlobWriter {
    constructor() { unsupported('zip.js') }
}
