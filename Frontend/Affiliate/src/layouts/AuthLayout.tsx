import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  return (
    <Suspense fallback={<div />}>
      <Outlet />
    </Suspense>
  );
}
