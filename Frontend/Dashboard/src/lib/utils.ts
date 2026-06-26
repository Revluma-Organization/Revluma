import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import api from './api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { api };
