import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { usePeek } from "../components/PeekDrawer";
import { TongQuan } from "./TongQuan";

export function PheDuyet() {
  const { id } = useParams();
  const { openPeek } = usePeek();

  useEffect(() => {
    if (id) openPeek({ type: "approval", id });
  }, [id, openPeek]);

  return <TongQuan />;
}
