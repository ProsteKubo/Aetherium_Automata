# makefile pro preklad LaTeX verze Bc. prace
# makefile for compilation of the thesis
# (c) 2008 Michal Bidlo
# E-mail: bidlom AT fit vut cz
# Edited by: dytrych AT fit vut cz
#===========================================
# asi budete chtit prejmenovat / you will probably rename:
CO=projekt
NORM_FILES=$(CO)-01-kapitoly-chapters-en.tex

all: $(CO).pdf

pdf: $(CO).pdf

diagrams:
	for f in mermaid-src/*.mmd; do \
		mmdc -i $$f -o obrazky-figures/$$(basename $$f .mmd).pdf -b transparent -C mermaid-src/thick.css -f; \
	done

$(CO).ps: $(CO).dvi
	dvips $(CO)

$(CO).pdf: clean
	pdflatex $(CO)
	-bibtex $(CO)
	# makeglossaries $(CO)
	# makeglossaries-lite $(CO)
	pdflatex $(CO)
	pdflatex $(CO)

$(CO).dvi: $(CO).tex $(CO).bib
	latex $(CO)
	-bibtex $(CO)
	latex $(CO)
	latex $(CO)

clean:
	rm -f *.dvi *.log $(CO).blg $(CO).bbl $(CO).toc *.aux $(CO).out $(CO).lof $(CO).ptc
	rm -f $(CO).pdf
	rm -f *~

pack:
	tar czvf $(CO).tar.gz *.tex *.bib *.bst ./template-fig/* ./bib-styles/* ./cls/* zadani.pdf $(CO).pdf Makefile Changelog

rename:
	mv $(CO).tex $(NAME).tex
	mv $(CO)-01-kapitoly-chapters.tex $(NAME)-01-kapitoly-chapters.tex
	mv $(CO)-01-kapitoly-chapters-en.tex $(NAME)-01-kapitoly-chapters-en.tex
	mv $(CO)-20-literatura-bibliography.bib $(NAME)-20-literatura-bibliography.bib
	mv $(CO)-30-prilohy-appendices.tex $(NAME)-30-prilohy-appendices.tex
	mv $(CO)-30-prilohy-appendices-en.tex $(NAME)-30-prilohy-appendices-en.tex
	sed -i "s/$(CO)-01-kapitoly-chapters/$(NAME)-01-kapitoly-chapters/g" $(NAME).tex
	sed -i "s/$(CO)-01-kapitoly-chapters-en/$(NAME)-01-kapitoly-chapters-en/g" $(NAME).tex
	sed -i "s/$(CO)-20-literatura-bibliography/$(NAME)-20-literatura-bibliography/g" $(NAME).tex
	sed -i "s/$(CO)-30-prilohy-appendices/$(NAME)-30-prilohy-appendices/g" $(NAME).tex
	sed -i "s/$(CO)-30-prilohy-appendices-en/$(NAME)-30-prilohy-appendices-en/g" $(NAME).tex
	sed -i "s/$(CO)/$(NAME)/g" Makefile
	
# Pozor, vlna neresi vse (viz popis.txt) / Warning - vlna is not solving all problems (see description.txt)
vlna:
	vlna -l $(CO)-*.tex

# Spocita normostrany / Count of standard pages
normostrany:
	detex -n $(NORM_FILES) | sed s/"^ *"/""/ | sed s/"^	*"/""/ | wc -c | awk '{ printf "%.2f\n", $$1 / 1800 }'

# Plain-text export (for AI analyzers, spell checkers, etc.)
# detex is bundled with TeX Live; no extra install needed.
txt: $(NORM_FILES)
	detex -n $(NORM_FILES) \
	  | sed '/^[[:space:]]*$$/N;/^\n$$/d' \
	  > $(CO).txt
	@echo "Plain text: $(CO).txt"

# DOCX / ODT export via pandoc (install: sudo pacman -S pandoc)
docx: $(NORM_FILES)
	@command -v pandoc >/dev/null 2>&1 || { echo "pandoc not found. Install: sudo pacman -S pandoc"; exit 1; }
	pandoc $(NORM_FILES) \
	  -f latex -t docx \
	  --bibliography=$(CO)-20-literatura-bibliography.bib \
	  -o $(CO).docx
	@echo "DOCX: $(CO).docx"

odt: $(NORM_FILES)
	@command -v pandoc >/dev/null 2>&1 || { echo "pandoc not found. Install: sudo pacman -S pandoc"; exit 1; }
	pandoc $(NORM_FILES) \
	  -f latex -t odt \
	  --bibliography=$(CO)-20-literatura-bibliography.bib \
	  -o $(CO).odt
	@echo "ODT (LibreOffice): $(CO).odt"
