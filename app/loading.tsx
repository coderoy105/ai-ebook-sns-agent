export default function Loading() {
  return (
    <main className="global-loading" aria-label="화면을 불러오는 중" aria-busy="true">
      <div className="global-loading-mark" aria-hidden="true"><i /><i /></div>
      <div>
        <strong>AI Book Studio</strong>
        <span>작업실을 준비하고 있습니다.</span>
      </div>
    </main>
  );
}
