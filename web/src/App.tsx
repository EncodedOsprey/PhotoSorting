import { ToastProvider } from './ui/components/Toast';
import { PhotoSortingApp } from './ui/PhotoSortingApp';

export default function App() {
  return (
    <ToastProvider>
      <PhotoSortingApp />
    </ToastProvider>
  );
}
