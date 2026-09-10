/** A File as the `{ data, mediaType }` pair the image routes take. */
export async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // data:<mime>;base64,<data>
      const comma = result.indexOf(",");
      const meta = result.slice(0, comma);
      const data = result.slice(comma + 1);
      const mediaType = meta.match(/data:(.*?);/)?.[1] ?? file.type ?? "image/png";
      resolve({ data, mediaType });
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}
