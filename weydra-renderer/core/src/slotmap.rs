//! Generational-index SlotMap.
//!
//! Handles are opaque `(slot, generation)` pairs. Removing + re-inserting into
//! the same slot bumps the generation so stale handles from the prior tenant
//! return `None` on lookup instead of silently pointing at new data.

/// Opaque handle: slot picks the Vec slot, generation invalidates reuse.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Handle {
    pub slot: u32,
    pub generation: u32,
}

impl Handle {
    /// Pack into a single `u64` so WASM bindings can shuttle handles as
    /// scalars. `generation` in the upper 32 bits, `slot` in the lower.
    pub fn to_u64(self) -> u64 {
        ((self.generation as u64) << 32) | (self.slot as u64)
    }

    pub fn from_u64(v: u64) -> Self {
        Self {
            slot: v as u32,
            generation: (v >> 32) as u32,
        }
    }
}

/// Stable-address slot pool. Handles stay valid as long as the slot isn't
/// freed; once freed, the slot's generation bumps so prior handles return
/// `None`.
pub struct SlotMap<T> {
    slots: Vec<Option<T>>,
    generations: Vec<u32>,
    free: Vec<u32>,
}

impl<T> SlotMap<T> {
    pub fn new() -> Self {
        Self {
            slots: Vec::new(),
            generations: Vec::new(),
            free: Vec::new(),
        }
    }

    pub fn with_capacity(cap: usize) -> Self {
        Self {
            slots: Vec::with_capacity(cap),
            generations: Vec::with_capacity(cap),
            free: Vec::with_capacity(cap),
        }
    }

    pub fn insert(&mut self, value: T) -> Handle {
        if let Some(slot) = self.free.pop() {
            self.slots[slot as usize] = Some(value);
            let generation = self.generations[slot as usize];
            Handle { slot, generation }
        } else {
            let len = self.slots.len();
            // slot is u32 — past u32::MAX, `as u32` would silently wrap and
            // alias a live handle. Panic is the right failure mode: no
            // realistic weydra workload crosses 4 billion slots.
            assert!(
                len < u32::MAX as usize,
                "SlotMap: slot index would overflow u32 ({} slots)",
                len
            );
            let slot = len as u32;
            self.slots.push(Some(value));
            self.generations.push(0);
            Handle { slot, generation: 0 }
        }
    }

    pub fn get(&self, h: Handle) -> Option<&T> {
        if (h.slot as usize) < self.slots.len()
            && self.generations[h.slot as usize] == h.generation
        {
            self.slots[h.slot as usize].as_ref()
        } else {
            None
        }
    }

    pub fn get_mut(&mut self, h: Handle) -> Option<&mut T> {
        if (h.slot as usize) < self.slots.len()
            && self.generations[h.slot as usize] == h.generation
        {
            self.slots[h.slot as usize].as_mut()
        } else {
            None
        }
    }

    pub fn remove(&mut self, h: Handle) -> Option<T> {
        if (h.slot as usize) >= self.slots.len()
            || self.generations[h.slot as usize] != h.generation
        {
            return None;
        }
        let v = self.slots[h.slot as usize].take();
        if v.is_some() {
            // wrapping_add so a hot slot recycled 2^32 times still yields
            // a valid, distinct generation number rather than panicking.
            self.generations[h.slot as usize] =
                self.generations[h.slot as usize].wrapping_add(1);
            self.free.push(h.slot);
        }
        v
    }

    pub fn iter(&self) -> impl Iterator<Item = (Handle, &T)> {
        self.slots.iter().enumerate().filter_map(move |(i, o)| {
            o.as_ref().map(|v| {
                (
                    Handle {
                        slot: i as u32,
                        generation: self.generations[i],
                    },
                    v,
                )
            })
        })
    }

    /// O(1): every slot not in the free list is occupied. `insert`/`remove`
    /// are the only paths that touch either Vec, and fields are private, so
    /// the invariant holds.
    pub fn len(&self) -> usize {
        self.slots.len() - self.free.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl<T> Default for SlotMap<T> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_get() {
        let mut s: SlotMap<i32> = SlotMap::new();
        let h = s.insert(42);
        assert_eq!(s.get(h), Some(&42));
    }

    #[test]
    fn remove_invalidates_handle() {
        let mut s: SlotMap<i32> = SlotMap::new();
        let h = s.insert(42);
        s.remove(h);
        assert_eq!(s.get(h), None);
    }

    #[test]
    fn reused_slot_different_generation() {
        let mut s: SlotMap<i32> = SlotMap::new();
        let h1 = s.insert(42);
        s.remove(h1);
        let h2 = s.insert(99);
        assert_eq!(h1.slot, h2.slot);
        assert_ne!(h1.generation, h2.generation);
        assert_eq!(s.get(h1), None);
        assert_eq!(s.get(h2), Some(&99));
    }

    #[test]
    fn handle_u64_roundtrip() {
        let h = Handle {
            slot: 0x1234_5678,
            generation: 0xDEAD_BEEF,
        };
        let v = h.to_u64();
        let h2 = Handle::from_u64(v);
        assert_eq!(h, h2);
    }
}
