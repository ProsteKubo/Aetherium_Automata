# usage: make filename.pdf
%.pdf: %.tex
	TEXINPUTS=.:./template//:$$TEXINPUTS pdflatex -interaction=nonstopmode -halt-on-error $<
	TEXINPUTS=.:./template//:$$TEXINPUTS pdflatex -interaction=nonstopmode -halt-on-error $<
