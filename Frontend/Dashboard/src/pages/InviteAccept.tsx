import { FC, useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { acceptInvite } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";

const InviteAccept: FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    if (!token || !user) return;

    setStatus("loading");
    acceptInvite(token)
      .then((data) => {
        setOrgName(data.organizationId);
        setStatus("success");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Invalid or expired invitation.";
        setErrorMsg(msg);
        setStatus("error");
      });
  }, [token, user]);

  // No token provided
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="h-16 w-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-t1 display">Invalid Invitation</h1>
            <p className="text-sm text-t3 mt-2">
              No invitation token was provided. Please use the link from your email.
            </p>
          </div>
          <Link to="/login">
            <Button className="bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-black font-bold text-sm h-10 px-6 rounded-lg gap-2">
              Go to Login
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Waiting for hydration
  if (!isHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-t3" />
      </div>
    );
  }

  // Not logged in — prompt to log in
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="h-16 w-16 rounded-full bg-[hsl(var(--accent)/0.1)] border border-[hsl(var(--accent)/0.2)] flex items-center justify-center mx-auto">
            <span className="text-2xl font-bold text-[hsl(var(--accent))]">R</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-t1 display">You're Invited!</h1>
            <p className="text-sm text-t3 mt-2">
              Sign in or create an account to accept this team invitation.
            </p>
          </div>
          <div className="space-y-3">
            <a
              href={`/auth/login.html?redirect=/invite/accept?token=${encodeURIComponent(token)}`}
              className="block"
            >
              <Button className="w-full bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-black font-bold text-sm h-10 rounded-lg gap-2">
                Sign In to Accept
                <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
            <a
              href={`/auth/signup.html?redirect=/invite/accept?token=${encodeURIComponent(token)}`}
              className="block"
            >
              <Button
                variant="outline"
                className="w-full text-sm h-10 rounded-lg font-medium"
              >
                Create an Account
              </Button>
            </a>
          </div>
          <p className="text-[0.7rem] text-t4">
            This invitation will expire in 7 days.
          </p>
        </div>
      </div>
    );
  }

  // Loading
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--accent))] mx-auto" />
          <p className="text-sm text-t3">Accepting your invitation...</p>
        </div>
      </div>
    );
  }

  // Success
  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="h-16 w-16 rounded-full bg-[#007FFF]/10 border border-[#007FFF]/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-[#007FFF]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-t1 display">Welcome to the Team!</h1>
            <p className="text-sm text-t3 mt-2">
              You're now a member of this organization. You can start using Revluma right away.
            </p>
          </div>
          <Link to="/dashboard/overview">
            <Button className="bg-[hsl(var(--accent))] hover:bg-[hsl(var(--accent-2))] !text-black font-bold text-sm h-10 px-6 rounded-lg gap-2">
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Error
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-4">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="h-16 w-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
          <AlertCircle className="h-7 w-7 text-red-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-t1 display">Invitation Failed</h1>
          <p className="text-sm text-t3 mt-2">{errorMsg}</p>
        </div>
        <Link to="/dashboard/overview">
          <Button variant="outline" className="text-sm h-10 px-6 rounded-lg font-medium">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default InviteAccept;
