use crate::device::GpuContext;
use std::collections::HashMap;

#[derive(Copy, Clone, Debug)]
pub struct ShaderHandle(pub u32);

pub struct CompiledShader {
    pub module: wgpu::ShaderModule,
    pub source_hash: u64,
}

pub struct ShaderRegistry {
    shaders: Vec<CompiledShader>,
    by_hash: HashMap<u64, u32>,
}

impl ShaderRegistry {
    pub fn new() -> Self {
        Self {
            shaders: Vec::new(),
            by_hash: HashMap::new(),
        }
    }

    /// Compile a WGSL source string into a shader module. Cached by source
    /// hash — repeated calls with identical source return the same handle.
    pub fn compile(&mut self, ctx: &GpuContext, source: &str, label: &str) -> ShaderHandle {
        let hash = fxhash(source);
        if let Some(&idx) = self.by_hash.get(&hash) {
            return ShaderHandle(idx);
        }

        let module = ctx
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });

        let idx = self.shaders.len() as u32;
        self.shaders.push(CompiledShader {
            module,
            source_hash: hash,
        });
        self.by_hash.insert(hash, idx);
        ShaderHandle(idx)
    }

    pub fn get(&self, h: ShaderHandle) -> Option<&CompiledShader> {
        self.shaders.get(h.0 as usize)
    }
}

impl Default for ShaderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Deterministic hash so cache hits on repeated compile calls. `RandomState`
/// would seed each hasher differently — cache would never hit.
fn fxhash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}
