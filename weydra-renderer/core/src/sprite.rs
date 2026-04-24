//! Sprite pool — Structure-of-Arrays layout whose per-attribute `Vec`s back
//! the shared-memory escape hatch.
//!
//! Arrays are fixed-size after `with_capacity`: once created they never
//! realloc, so typed-array views on the TS side can cache `(ptr, len)` across
//! `create_sprite` / `destroy_sprite` without a revalidate step. Growth would
//! detach the underlying `ArrayBuffer` silently (see spec "Convenção de
//! views sobre WASM memory"), so overflow is a loud panic, not a silent grow.
//!
//! Handles are allocated by a `SlotMap<SpriteMeta>`; visible sprites are
//! anything with `FLAG_VISIBLE` set in `flags[slot]`.

use crate::slotmap::{Handle, SlotMap};
use bytemuck::{Pod, Zeroable};

/// Per-sprite transform. TS writes to these directly via a `Float32Array`
/// view. `scale_x` negative flips horizontally (matches Pixi flipX convention).
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct SpriteTransform {
    pub x: f32,
    pub y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
}

impl Default for SpriteTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
        }
    }
}

/// Per-sprite UV sub-frame, coords in 0..1 of the parent texture.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct SpriteUv {
    pub u: f32,
    pub v: f32,
    pub w: f32,
    pub h: f32,
}

impl Default for SpriteUv {
    fn default() -> Self {
        Self {
            u: 0.0,
            v: 0.0,
            w: 1.0,
            h: 1.0,
        }
    }
}

/// Sprite metadata — texture + display size. Not hot path; keep off the SoA.
#[derive(Copy, Clone, Debug)]
pub struct SpriteMeta {
    pub texture: Handle,
    pub display_w: f32,
    pub display_h: f32,
}

/// Visibility bit in `flags[slot]`. Render loop filters sprites with this
/// bit cleared before batching.
pub const FLAG_VISIBLE: u8 = 0b0000_0001;

/// Structure-of-Arrays sprite pool. Each array is indexed by `Handle::slot`.
/// `meta` holds the per-sprite lookup data; the parallel `Vec`s are the
/// pointer-exposed attributes that TS writes directly.
pub struct SpritePool {
    pub transforms: Vec<SpriteTransform>,
    pub uvs: Vec<SpriteUv>,
    /// Packed RGBA8 tint. `0xRR_GG_BB_AA` — `0xFFFFFFFF` = white opaque.
    pub colors: Vec<u32>,
    /// Bit 0 = visible (`FLAG_VISIBLE`). Bits 1-7 reserved.
    pub flags: Vec<u8>,
    pub z_order: Vec<f32>,

    pub meta: SlotMap<SpriteMeta>,
    capacity: usize,
}

impl SpritePool {
    pub fn with_capacity(cap: usize) -> Self {
        assert!(cap > 0, "SpritePool capacity must be > 0");
        Self {
            transforms: vec![SpriteTransform::default(); cap],
            uvs: vec![SpriteUv::default(); cap],
            colors: vec![0xFFFF_FFFFu32; cap],
            flags: vec![0u8; cap],
            z_order: vec![0.0f32; cap],
            meta: SlotMap::with_capacity(cap),
            capacity: cap,
        }
    }

    pub fn is_full(&self) -> bool {
        // SoA arrays are fixed-size. SlotMap would allocate a new slot and
        // index the SoA arrays out-of-bounds if we let it grow past
        // capacity.
        self.meta.len() >= self.capacity
    }

    pub fn insert(&mut self, texture: Handle, display_w: f32, display_h: f32) -> Handle {
        assert!(
            !self.is_full(),
            "SpritePool full (cap={}). SlotMap::insert would grow beyond SoA array bounds, \
             silently invalidating TS typed views. Increase capacity or destroy unused sprites.",
            self.capacity,
        );
        let h = self.meta.insert(SpriteMeta {
            texture,
            display_w,
            display_h,
        });
        debug_assert!((h.slot as usize) < self.capacity);
        let slot = h.slot as usize;
        self.transforms[slot] = SpriteTransform::default();
        self.uvs[slot] = SpriteUv::default();
        self.colors[slot] = 0xFFFF_FFFFu32;
        self.flags[slot] = FLAG_VISIBLE;
        self.z_order[slot] = 0.0;
        h
    }

    pub fn remove(&mut self, h: Handle) {
        if self.meta.remove(h).is_some() {
            // Clear visibility so a lingering draw call skips this slot
            // before the next insert reinitialises flags.
            self.flags[h.slot as usize] = 0;
        }
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn len(&self) -> usize {
        self.meta.len()
    }

    pub fn is_empty(&self) -> bool {
        self.meta.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_tex() -> Handle {
        Handle {
            slot: 0,
            generation: 0,
        }
    }

    #[test]
    fn insert_initialises_defaults() {
        let mut p = SpritePool::with_capacity(4);
        let h = p.insert(fake_tex(), 32.0, 32.0);
        assert_eq!(p.transforms[h.slot as usize].scale_x, 1.0);
        assert_eq!(p.colors[h.slot as usize], 0xFFFF_FFFF);
        assert_eq!(p.flags[h.slot as usize] & FLAG_VISIBLE, FLAG_VISIBLE);
        assert_eq!(p.len(), 1);
    }

    #[test]
    fn remove_clears_visibility() {
        let mut p = SpritePool::with_capacity(4);
        let h = p.insert(fake_tex(), 32.0, 32.0);
        p.remove(h);
        assert_eq!(p.flags[h.slot as usize], 0);
        assert_eq!(p.len(), 0);
    }

    #[test]
    #[should_panic(expected = "SpritePool full")]
    fn insert_past_capacity_panics() {
        let mut p = SpritePool::with_capacity(2);
        p.insert(fake_tex(), 1.0, 1.0);
        p.insert(fake_tex(), 1.0, 1.0);
        p.insert(fake_tex(), 1.0, 1.0); // boom
    }

    #[test]
    fn sprite_transform_layout() {
        assert_eq!(std::mem::size_of::<SpriteTransform>(), 16);
        assert_eq!(std::mem::size_of::<SpriteUv>(), 16);
    }
}
