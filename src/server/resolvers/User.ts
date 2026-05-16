import { defineType } from "@/frame/server";
import { User as UserType } from "@/server/schema/types";

export const User = defineType(UserType)({});
