

var unassignedSubtypes = tableResultGetColumn(glue.command(["list", "alignment", "-w", "status = 'unassigned'"]), "name");

_.each(unassignedSubtypes, function(unassignedSubtype) {
	
	var completeGenomes;
	glue.inMode("alignment/"+unassignedSubtype, function() {
		completeGenomes = 
			glue.command(["count", "member", "-w", 
			              "sequence.source.name = 'ncbi-curated' and sequence.gb_length >= 8000"]).countResult.count;
		
	});
	
	glue.log("INFO", "completeGenomesCount", unassignedSubtype+": "+completeGenomes)
});
