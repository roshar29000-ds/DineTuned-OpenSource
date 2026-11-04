'use client';
import { useParams } from 'next/navigation';
import { ProfileGate } from '../../../components/ProfileGate';
import { MenuRetrievalGateway } from '../../../components/menu-retrieval/MenuRetrievalGateway';

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>();
  return <ProfileGate><MenuRetrievalGateway key={id} restaurantId={id}/></ProfileGate>;
}
