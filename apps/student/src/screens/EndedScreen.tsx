import { useSession } from '../state/SessionProvider';

export function EndedScreen() {
  const { leave } = useSession();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-5">
      <div className="lr-panel w-full max-w-sm p-6 text-center">
        <h1 className="font-pixel text-[16px] text-lr-dark">Class ended.</h1>
        <div className="lr-rule mx-auto mt-4 w-16" />
        <p className="lr-text mt-4 text-[15px] text-lr-dark">Thanks for participating.</p>
        <button
          type="button"
          className="lr-btn lr-btn-primary lr-btn-lg mt-6 min-h-[56px] w-full"
          onClick={leave}
        >
          BACK TO JOIN
        </button>
      </div>
    </main>
  );
}
