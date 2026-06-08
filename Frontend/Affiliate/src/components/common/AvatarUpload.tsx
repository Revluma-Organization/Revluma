import { useState, useRef, useCallback, type ChangeEvent, type DragEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { compressImage, validateImage } from '../../utils/imageCompress';
import * as api from '../../lib/api';

interface AvatarUploadProps {
  onClose: () => void;
}

export default function AvatarUpload({ onClose }: AvatarUploadProps) {
  const { user, hydrateUser } = useAuth();
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    const validationError = validateImage(f);
    if (validationError) {
      setError(validationError);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
    setFile(f);
  }, []);

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('avatar', compressed, 'avatar.webp');
      const result = await api.uploadAvatar(formData);
      hydrateUser({ ...user!, avatarUrl: result.avatarUrl });
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-modal)',
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Upload profile picture"
    >
      <div
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 400,
          padding: 24,
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>
            Change Photo
          </h2>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', cursor: 'pointer', border: 'none', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--color-brand)' : 'var(--color-border)'}`,
            borderRadius: 10,
            padding: 32,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            background: dragging ? 'var(--color-brand-muted)' : 'transparent',
            marginBottom: 16,
          }}
        >
          {preview ? (
            <img
              src={preview}
              alt="Preview"
              style={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                objectFit: 'cover',
                margin: '0 auto',
                display: 'block',
              }}
            />
          ) : (
            <div style={{ color: 'var(--color-text-tertiary)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px', opacity: 0.4 }}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
              </svg>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                Drop an image here or click to browse
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                JPEG, PNG, WebP, AVIF max 5MB
              </div>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={handleSelect}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        </div>

        {error && (
          <div style={{
            fontSize: 12,
            color: 'var(--color-error)',
            background: 'var(--color-error-bg)',
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              color: '#fff',
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              border: 'none',
              background: !file || uploading ? 'var(--color-text-tertiary)' : 'var(--color-brand)',
              opacity: !file || uploading ? 0.5 : 1,
              transition: 'all var(--transition-fast)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {uploading && (
              <div style={{
                width: 14,
                height: 14,
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite',
              }} />
            )}
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
