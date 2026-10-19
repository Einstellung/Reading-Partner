// Phoneme string to model input ids, exactly as `kokoro.KModel.forward` does
// it: every char looked up in the vocabulary, the ones it does not know dropped
// silently, and the pad (0) put on both ends.

use super::vocab::{PAD, VOCAB};

/// The longest phoneme string one call takes: the model's context is 512 ids
/// and two of them are the pads. KPipeline cuts at 510 chars before it ever
/// reaches the model; here a longer string is the caller's bug.
pub const MAX_PHONEMES: usize = 510;

pub fn token_id(c: char) -> Option<i64> {
    VOCAB
        .binary_search_by_key(&c, |&(k, _)| k)
        .ok()
        .map(|i| VOCAB[i].1)
}

/// The number of phonemes as Kokoro counts them, which is what picks the row
/// of the voice table: chars of the string, unknown ones included.
pub fn phoneme_len(phonemes: &str) -> usize {
    phonemes.chars().count()
}

pub fn tokenize(phonemes: &str) -> Result<Vec<i64>, String> {
    let n = phoneme_len(phonemes);
    if n == 0 {
        return Err("Nothing to say: the phoneme string is empty.".into());
    }
    if n > MAX_PHONEMES {
        return Err(format!(
            "{n} phonemes is more than one Kokoro call takes ({MAX_PHONEMES}); cut the sentence first."
        ));
    }
    let mut ids = Vec::with_capacity(n + 2);
    ids.push(PAD);
    ids.extend(phonemes.chars().filter_map(token_id));
    ids.push(PAD);
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_is_sorted_and_complete() {
        assert_eq!(VOCAB.len(), 171);
        assert!(VOCAB.windows(2).all(|w| w[0].0 < w[1].0));
        assert!(VOCAB.iter().all(|&(_, id)| id > 0 && id < 178));
    }

    #[test]
    fn known_ids_match_the_config() {
        // A few from hexgrad/Kokoro-82M-v1.1-zh config.json.
        assert_eq!(token_id(' '), Some(16));
        assert_eq!(token_id('!'), Some(5));
        assert_eq!(token_id('ㄋ'), token_id('\u{310b}'));
        assert!(token_id('ㄋ').is_some());
        assert_eq!(token_id('$'), None);
        assert_eq!(token_id('❓'), None);
    }

    #[test]
    fn tokenize_pads_both_ends_and_drops_unknowns() {
        let ids = tokenize("ㄋ❓!").unwrap();
        assert_eq!(ids.first(), Some(&PAD));
        assert_eq!(ids.last(), Some(&PAD));
        assert_eq!(ids.len(), 4);
        assert_eq!(ids[2], 5);
        assert_eq!(phoneme_len("ㄋ❓!"), 3);
    }

    #[test]
    fn tokenize_refuses_empty_and_overlong() {
        assert!(tokenize("").is_err());
        assert!(tokenize(&"a".repeat(MAX_PHONEMES)).is_ok());
        assert!(tokenize(&"a".repeat(MAX_PHONEMES + 1)).is_err());
    }
}
