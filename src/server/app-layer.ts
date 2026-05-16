import { Layer } from "effect";
import { Db } from "./services/db";

export const AppLayer = Layer.mergeAll(Db.Default);
