import React from 'react';

interface SkeletonPros {
    className?: string;
}

export default function Skeleton ({ className = ''}: SkeletonPros) {
    return (
        <div
        className={`animate-pulse bg-white/10 rounded-md ${className}`}
        />
    )
}