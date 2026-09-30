export function Footer() {
    return (
        <footer className="border-grid border-t py-6 md:px-8 md:py-0">
            <div className="container-wrapper">
                <div className="container py-4">
                    <div className="text-balance text-center text-sm leading-loose text-muted-foreground md:text-left">
                        {"Built by "}
                        <a
                            href="https://github.com/tomgroenwoldt"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline underline-offset-4"
                        >
                            {"tomgroenwoldt"}
                        </a>
                        {" with "}
                        <a
                            href="https://ui.shadcn.com"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline underline-offset-4"
                        >
                            {"shadcn/ui"}
                        </a>
                        {". Utilizes the awesome "}
                        <a
                            href="https://helix-editor.com/"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline underline-offset-4"
                        >
                            {"helix editor"}
                        </a>
                        {"."}
                    </div>
                </div>
            </div>
        </footer>
    );
}
