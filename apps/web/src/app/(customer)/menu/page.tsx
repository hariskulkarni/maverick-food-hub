import { redirect } from 'next/navigation';
// Menu is now per-restaurant; the platform homepage shows the restaurant directory.
export default function MenuRedirect() { redirect('/restaurants'); }
