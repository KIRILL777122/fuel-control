"use client";

import { useParams } from "next/navigation";
import RepairEditor from "../RepairEditor";

export default function RepairCardPage() {
  const params = useParams();
  const id = params?.id as string;
  return <RepairEditor id={id} />;
}
