use std::fmt;

#[derive(Debug)]
pub enum WeydraError {
    AdapterNotFound,
    DeviceRequestFailed(wgpu::RequestDeviceError),
    SurfaceCreationFailed(String),
}

impl fmt::Display for WeydraError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AdapterNotFound => write!(f, "no suitable GPU adapter found"),
            Self::DeviceRequestFailed(e) => write!(f, "failed to request device: {e}"),
            Self::SurfaceCreationFailed(m) => write!(f, "failed to create surface: {m}"),
        }
    }
}

impl std::error::Error for WeydraError {}

impl From<wgpu::RequestDeviceError> for WeydraError {
    fn from(e: wgpu::RequestDeviceError) -> Self {
        Self::DeviceRequestFailed(e)
    }
}

pub type Result<T> = std::result::Result<T, WeydraError>;
