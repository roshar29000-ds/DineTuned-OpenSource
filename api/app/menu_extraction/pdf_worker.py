"""Isolated PDF reader: stdin bytes, bounded JSON stdout, no credentials or network."""
import io
import json
import sys


def main():
    # Linux enforces an address-space cap. Some macOS versions reject both memory
    # limits; those retain CPU/wall-clock, input, page/text and decompression limits.
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (4, 4))
    memory_limit = resource.RLIMIT_DATA if sys.platform == 'darwin' else resource.RLIMIT_AS
    try:
        resource.setrlimit(memory_limit, (768 * 1024 * 1024, 768 * 1024 * 1024))
    except (ValueError, OSError):
        if sys.platform != 'darwin': raise
    import socket
    def no_network(*args, **kwargs): raise RuntimeError('PDF workers cannot access networks')
    socket.socket = no_network
    socket.create_connection = no_network
    from pypdf import PdfReader, filters
    for name in ('ZLIB_MAX_OUTPUT_LENGTH', 'LZW_MAX_OUTPUT_LENGTH', 'RUN_LENGTH_MAX_OUTPUT_LENGTH',
                 'MAX_ARRAY_BASED_STREAM_OUTPUT_LENGTH', 'MAX_DECLARED_STREAM_LENGTH'):
        setattr(filters, name, 8_000_000)
    data = sys.stdin.buffer.read(2_000_001)
    if len(data) > 2_000_000: raise ValueError()
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted: raise ValueError()
    if not 0 < len(reader.pages) <= 24: raise ValueError()
    pages, length = [], 0
    for number, page in enumerate(reader.pages, 1):
        headings, bold = [], []
        def visitor(text, cm, tm, font, size):
            if font and 'Bold' in str(font.get('/BaseFont', '')):
                for line in text.splitlines():
                    if line.strip():
                        (headings if size >= 13 else bold).append(' '.join(line.split()))
        page.extract_text(visitor_text=visitor)
        text = page.extract_text(extraction_mode='layout', layout_mode_space_vertically=False)
        length += len(text)
        if length > 120000: raise ValueError()
        pages.append({'number': number, 'text': text, 'headings': headings[:300], 'bold': bold[:600]})
    print(json.dumps({'pages': pages}, ensure_ascii=False))


if __name__ == '__main__':
    try: main()
    except Exception:
        print('{"error":"PDF could not be read within the supported safety limits."}')
        sys.exit(1)
