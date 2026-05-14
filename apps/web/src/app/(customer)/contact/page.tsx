import { brand } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, MessageCircle, Clock, MapPin } from 'lucide-react';
import { prisma } from '@/server/db';

export const metadata = { title: 'Contact' };

export default async function ContactPage() {
  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  return (
    <div className="container py-12 max-w-3xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Contact</div>
      <h1 className="display text-3xl font-semibold mb-6">We'd love to hear from you</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-5"><h3 className="font-semibold flex items-center gap-2"><Phone className="size-4" /> Call us</h3><a href={`tel:${brand.supportPhone}`} className="mt-2 block text-lg hover:text-primary">{brand.supportPhone}</a></CardContent></Card>
        <Card><CardContent className="p-5"><h3 className="font-semibold flex items-center gap-2"><MessageCircle className="size-4" /> WhatsApp</h3><a href={`https://wa.me/${brand.supportWhatsapp.replace(/\D/g, '')}`} className="mt-2 block text-lg hover:text-primary">{brand.supportWhatsapp}</a></CardContent></Card>
        {branch && (
          <Card className="md:col-span-2"><CardContent className="p-5">
            <h3 className="font-semibold flex items-center gap-2"><MapPin className="size-4" /> Visit us</h3>
            <p className="mt-2 text-sm text-muted-foreground">{branch.line1}, {branch.city} {branch.postalCode}</p>
            <h3 className="font-semibold flex items-center gap-2 mt-4"><Clock className="size-4" /> Hours</h3>
            <p className="mt-2 text-sm text-muted-foreground">Open daily, 11:00 — 23:00</p>
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}
