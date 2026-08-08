import { Module } from "@nestjs/common";
import { ParticipantController } from "./participant.controller.js";

/** Controllers only — see CONTRIBUTING.md for the per-request construction pattern. */
@Module({ controllers: [ParticipantController] })
export class ParticipantModule {}
