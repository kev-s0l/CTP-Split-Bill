import { beforeEach, describe, it, expect, vi } from "vitest";

const storage = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
  getContainerClient: vi.fn(),
  createIfNotExists: vi.fn(),
  getProperties: vi.fn(),
  getBlockBlobClient: vi.fn(),
  uploadData: vi.fn(),
  deleteIfExists: vi.fn(),
}));

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: { fromConnectionString: storage.fromConnectionString },
}));

import { deleteAttachment, safeBlobName, storageAvailable, uploadAttachment } from "../src/storage";

let containerExists = false;

beforeEach(() => {
  vi.resetAllMocks();
  containerExists = false;
  storage.fromConnectionString.mockReturnValue({ getContainerClient: storage.getContainerClient });
  storage.getContainerClient.mockReturnValue({
    createIfNotExists: storage.createIfNotExists,
    getProperties: storage.getProperties,
    getBlockBlobClient: storage.getBlockBlobClient,
  });
  storage.getBlockBlobClient.mockReturnValue({
    uploadData: storage.uploadData,
    deleteIfExists: storage.deleteIfExists,
  });
  storage.createIfNotExists.mockImplementation(async () => {
    await Promise.resolve();
    containerExists = true;
  });
  storage.getProperties.mockImplementation(async () => {
    if (!containerExists) throw new Error("Container not found");
    return {};
  });
  storage.uploadData.mockImplementation(async () => {
    if (!containerExists) throw new Error("Container not found");
    return {};
  });
});

describe("safeBlobName", () => {
  it("namespaces by item id", () => {
    expect(safeBlobName("item1", "resume.pdf")).toBe("item1/resume.pdf");
  });

  it("neutralizes path traversal", () => {
    expect(safeBlobName("item1", "../../etc/passwd")).toBe("item1/__etc_passwd");
    expect(safeBlobName("item1", "a/b/c.pdf")).not.toContain("a/b");
  });

  it("handles empty and hostile names", () => {
    expect(safeBlobName("item1", "")).toBe("item1/file");
    expect(safeBlobName("item1", "  spaces & symbols!.png")).toBe("item1/__spaces___symbols_.png");
  });

  it("caps absurdly long names", () => {
    const name = safeBlobName("item1", "x".repeat(500) + ".pdf");
    expect(name.length).toBeLessThanOrEqual("item1/".length + 100);
  });
});

describe("storageAvailable", () => {
  it("initializes a fresh container before probing its metadata", async () => {
    expect(await storageAvailable()).toBe(true);
    expect(storage.getContainerClient).toHaveBeenCalledWith("attachments");
    expect(storage.createIfNotExists).toHaveBeenCalledOnce();
    expect(storage.getProperties).toHaveBeenCalledOnce();
  });

  it("returns false when container initialization fails", async () => {
    storage.createIfNotExists.mockRejectedValueOnce(new Error("Storage is offline"));
    expect(await storageAvailable()).toBe(false);
    expect(storage.getProperties).not.toHaveBeenCalled();
  });

  it("returns false when the metadata probe fails", async () => {
    storage.getProperties.mockRejectedValueOnce(new Error("Storage is offline"));
    expect(await storageAvailable()).toBe(false);
  });
});

describe("uploadAttachment", () => {
  it("uploads into a fresh container without requiring an availability probe", async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    expect(await uploadAttachment("receipt1", "dinner photo.png", "image/png", data))
      .toBe("receipt1/dinner_photo.png");
    expect(storage.getContainerClient).toHaveBeenCalledWith("attachments");
    expect(storage.createIfNotExists).toHaveBeenCalledOnce();
    expect(storage.getBlockBlobClient).toHaveBeenCalledWith("receipt1/dinner_photo.png");
    expect(storage.uploadData).toHaveBeenCalledWith(data, {
      blobHTTPHeaders: { blobContentType: "image/png" },
    });
  });

  it("propagates initialization failures without uploading", async () => {
    const failure = new Error("Storage is offline");
    storage.createIfNotExists.mockRejectedValueOnce(failure);
    await expect(uploadAttachment("receipt1", "dinner.png", "image/png", new ArrayBuffer(1)))
      .rejects.toBe(failure);
    expect(storage.uploadData).not.toHaveBeenCalled();
  });

  it("propagates upload failures", async () => {
    const failure = new Error("Upload failed");
    storage.uploadData.mockRejectedValueOnce(failure);
    await expect(uploadAttachment("receipt1", "dinner.png", "image/png", new ArrayBuffer(1)))
      .rejects.toBe(failure);
  });
});

describe("deleteAttachment", () => {
  it("deletes an existing blob and succeeds when it is already absent", async () => {
    storage.deleteIfExists
      .mockResolvedValueOnce({ succeeded: true })
      .mockResolvedValueOnce({ succeeded: false });

    await expect(deleteAttachment("receipt1/dinner.png")).resolves.toBeUndefined();
    await expect(deleteAttachment("receipt1/dinner.png")).resolves.toBeUndefined();

    expect(storage.getContainerClient).toHaveBeenCalledWith("attachments");
    expect(storage.getBlockBlobClient).toHaveBeenNthCalledWith(1, "receipt1/dinner.png");
    expect(storage.getBlockBlobClient).toHaveBeenNthCalledWith(2, "receipt1/dinner.png");
    expect(storage.deleteIfExists).toHaveBeenCalledTimes(2);
    expect(storage.createIfNotExists).not.toHaveBeenCalled();
  });

  it("propagates deletion failures so cleanup can be logged by the caller", async () => {
    const failure = new Error("Delete failed");
    storage.deleteIfExists.mockRejectedValueOnce(failure);
    await expect(deleteAttachment("receipt1/dinner.png")).rejects.toBe(failure);
  });
});
