import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { toProblemDetails } from "../src/http/problem-details.filter.js";

describe("RFC 9457 problem details", () => {
  it("maps Nest exceptions without leaking implementation details", () => {
    expect(
      toProblemDetails(new NotFoundException("Campus not found"), "/v1/campuses/nope", "trace-1"),
    ).toEqual({
      type: "https://api.gopher-assistant.example/problems/not-found",
      title: "Not Found",
      status: 404,
      detail: "Campus not found",
      instance: "/v1/campuses/nope",
      traceId: "trace-1",
    });
  });

  it("normalizes array validation messages", () => {
    const exception = new BadRequestException({ message: ["campusId must be valid"], error: "Bad Request" });
    expect(toProblemDetails(exception, "/v1/sources", "trace-2").detail).toBe("campusId must be valid");
  });

  it("hides unexpected exception messages", () => {
    const result = toProblemDetails(new Error("database password leaked"), "/v1/sources", "trace-3");
    expect(result.status).toBe(500);
    expect(result.detail).toBe("An unexpected error occurred.");
  });
});
