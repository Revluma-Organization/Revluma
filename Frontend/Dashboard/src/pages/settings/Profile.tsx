import { FC } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X } from "lucide-react";

const Profile: FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-4xl space-y-8"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      </div>

      <div className="space-y-8 border rounded-xl p-6 bg-white shadow-sm">
        {/* Profile Picture Section */}
        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">Profile Picture</h3>
          <div className="flex items-center gap-6 mt-2">
            <div className="h-16 w-16 rounded-full bg-muted overflow-hidden flex items-center justify-center">
              <img src="https://ui-avatars.com/api/?name=Dianne+Russell&background=f3f4f6&color=374151" alt="Avatar" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Button className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white flex items-center gap-2 rounded-lg">
                  <Upload className="h-4 w-4" />
                  Upload Image
                </Button>
                <Button variant="outline" className="rounded-lg border-gray-200">
                  Remove
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">We support PNGs, JPEGs and GIFs under 10MB</p>
            </div>
          </div>
        </div>

        {/* Name Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="firstName" className="text-sm font-medium">First Name</Label>
            <Input id="firstName" defaultValue="Dianne" className="rounded-lg border-gray-200" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName" className="text-sm font-medium">Last Name</Label>
            <Input id="lastName" defaultValue="Russell" className="rounded-lg border-gray-200" />
          </div>
        </div>

        {/* Email Section */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">Email</Label>
          <div className="flex items-center gap-4">
            <Input id="email" defaultValue="russel@hey.com" readOnly className="max-w-md rounded-lg border-gray-200 bg-gray-50/50 text-muted-foreground" />
            <Button variant="outline" className="rounded-lg border-gray-200">Edit Email</Button>
          </div>
          <p className="text-xs text-muted-foreground pt-1">Used to log in to your account</p>
        </div>
        
        <hr className="border-gray-100" />

        {/* Password Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-medium text-sm">Password</h3>
            <p className="text-sm text-muted-foreground">Log in with your password instead of using temporary login codes</p>
          </div>
          <Button variant="outline" className="rounded-lg border-gray-200">Change Password</Button>
        </div>
      </div>

      {/* Save / Cancel Bar */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t">
        <Button variant="ghost" className="rounded-lg">Cancel</Button>
        <Button className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white px-8 rounded-lg">Save</Button>
      </div>
    </motion.div>
  );
};

export default Profile;
