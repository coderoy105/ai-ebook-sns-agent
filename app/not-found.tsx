import Link from "next/link";
import { ProductMark } from "@/components/product-mark";

export default function NotFound() {
  return (
    <main className="not-found-stage">
      <ProductMark href="/dashboard" />
      <div className="not-found-copy">
        <span>404</span>
        <h1>이 페이지는 원고에서 빠져 있습니다.</h1>
        <p>주소가 바뀌었거나 존재하지 않는 작업 화면입니다. 저장된 프로젝트는 대시보드에서 다시 찾을 수 있습니다.</p>
        <Link className="button button-primary" href="/dashboard">작업실로 돌아가기</Link>
      </div>
    </main>
  );
}
