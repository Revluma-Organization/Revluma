import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

export default function SettingsLayout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Suspense fallback={<div />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
