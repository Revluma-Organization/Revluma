import React from 'react';

const LoadingSpinner: React.FC = () => {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-20">
      <div className="flex flex-col items-center gap-4">
        {/* Animated spinner */}
        <div className="w-12 h-12 border-4 border-gray-300 border-t-white rounded-full animate-spin"></div>
        
        {/* Loading text */}
        <p className="text-gray-400 font-medium">Loading...</p>
      </div>
    </div>
  );
};

export default LoadingSpinner;
